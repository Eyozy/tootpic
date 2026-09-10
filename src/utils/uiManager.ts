import { templateManager } from './templateManager';
import { imageGenerator } from './imageGenerator';
import { DOM_ELEMENT_IDS } from '../constants';
import { renderMarkdownToHtml, detectsMarkdown } from './markdownRender';
import type { FediversePost, FediverseAttachment, FediversePoll } from '../types/activitypub';
import DOMPurify from 'dompurify';

/**
 * Safely sanitize HTML content to prevent XSS attacks
 */
function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
            'b', 'i', 'em', 'strong', 'a', 'p', 'br', 'span', 'div',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
            'img', 'video', 'audio', 'source'
        ],
        ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'src', 'alt'],
        ALLOW_DATA_ATTR: false
    });
}

/**
 * Escape HTML special characters to prevent XSS when inserting as text
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

interface PrefetchedMetaData {
    postData: FediversePost;
    imageMap: Record<string, string>;
    imageUrls: string[];
    fetchedInstance: string;
}

interface StreamedImageData {
    url: string;
    dataUrl: string;
}

function computeMediaGridStyle({
    count,
    hasVideosOrGifs,
}: {
    count: number;
    hasVideosOrGifs: boolean;
}): { columns: string; aspectRatio?: string } {
    const columns = count > 1 ? '1fr 1fr' : '1fr';
    let aspectRatio: string | undefined;
    if (count >= 2 && !hasVideosOrGifs) {
        aspectRatio = '3 / 2';
    }
    return { columns, aspectRatio };
}

document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById(DOM_ELEMENT_IDS.MASTODON_URL) as HTMLInputElement;
    const generateBtn = document.getElementById(DOM_ELEMENT_IDS.GENERATE_BTN) as HTMLButtonElement;
    const downloadBtn = document.getElementById(DOM_ELEMENT_IDS.DOWNLOAD_BTN) as HTMLButtonElement;
    const copyBtn = document.getElementById(DOM_ELEMENT_IDS.COPY_BTN) as HTMLButtonElement;
    const errorMessage = document.getElementById(DOM_ELEMENT_IDS.ERROR_MESSAGE) as HTMLDivElement;
    const previewArea = document.getElementById(DOM_ELEMENT_IDS.PREVIEW_AREA) as HTMLDivElement;
    const loader = document.getElementById(DOM_ELEMENT_IDS.LOADER) as HTMLDivElement;
    const styleAContainer = document.getElementById(DOM_ELEMENT_IDS.STYLE_A_CONTAINER) as HTMLDivElement;
    const clearUrlBtn = document.getElementById(DOM_ELEMENT_IDS.CLEAR_URL_BTN) as HTMLButtonElement;
    const visibilityCheckboxes = document.querySelectorAll<HTMLInputElement>('input[name="visibility"]');
    const templateToggle = document.getElementById(DOM_ELEMENT_IDS.TEMPLATE_TOGGLE) as HTMLButtonElement;
    const optionsToggle = document.getElementById(DOM_ELEMENT_IDS.OPTIONS_TOGGLE) as HTMLButtonElement;
    const optionsContent = document.getElementById(DOM_ELEMENT_IDS.OPTIONS_CONTENT) as HTMLDivElement;
    const optionsIcon = document.getElementById(DOM_ELEMENT_IDS.OPTIONS_ICON) as SVGElement;
    const previewStatus = document.getElementById(DOM_ELEMENT_IDS.PREVIEW_STATUS) as HTMLSpanElement;
    const contentWarningBanner = document.getElementById(DOM_ELEMENT_IDS.CONTENT_WARNING_BANNER) as HTMLDivElement;
    const contentWarningText = document.getElementById(DOM_ELEMENT_IDS.CONTENT_WARNING_TEXT) as HTMLSpanElement;
    const contentWarningToggle = document.getElementById(DOM_ELEMENT_IDS.CONTENT_WARNING_TOGGLE) as HTMLInputElement;
    const contentWarningToggleContainer = document.getElementById(DOM_ELEMENT_IDS.CONTENT_WARNING_TOGGLE_CONTAINER) as HTMLDivElement;
    const quoteToggleContainer = document.getElementById('quote-toggle-container') as HTMLDivElement;
    const extensionContainer = document.getElementById(DOM_ELEMENT_IDS.EXTENSION) as HTMLDivElement;

    let postData: FediversePost | null = null;
    let fetchedInstance = '';
    let imageMap: Record<string, string> = {};
    let visibility = { stats: true, timestamp: true, instance: true, contentWarning: true, quote: true };
    let eventSource: EventSource | null = null;
    let loadedImageUrls = new Set<string>();
    let failedImageUrls = new Set<string>();
    let isRendering = false;
    let pendingRender = false;
    const clientVideoThumbnailCache = new Map<string, string>();

    function buildVideoProxyUrl(origin: string, videoUrl: string): string {
        return `${origin}/api/video-proxy?url=${encodeURIComponent(videoUrl)}`;
    }

    function buildImageProxyUrl(origin: string, imageUrl: string): string {
        return `${origin}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
    }

    function buildImageProbeUrl(origin: string, imageUrl: string): string {
        return `${origin}/api/image-proxy?url=${encodeURIComponent(imageUrl)}&probe=1`;
    }

    async function probeVideoPreviewImage(imageUrl: string, timeoutMs: number = 500): Promise<boolean> {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(imageUrl, {
                method: 'GET',
                signal: controller.signal,
                cache: 'no-store',
            });
            return response.headers.get('X-Image-Available') === '1';
        } catch {
            return false;
        } finally {
            clearTimeout(timer);
        }
    }

    async function captureClientVideoThumbnail(videoUrl: string, seekSeconds: number = 0.8, timeoutMs: number = 2500): Promise<string | null> {
        const cachedThumbnail = clientVideoThumbnailCache.get(videoUrl);
        if (cachedThumbnail) return cachedThumbnail;

        return new Promise(resolve => {
            const video = document.createElement('video');
            let settled = false;
            let targetTime = seekSeconds;
            let startedAt = 0;

            const cleanup = () => {
                video.pause();
                video.removeAttribute('src');
                video.load();
                video.remove();
            };

            const finish = (dataUrl: string | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                cleanup();

                if (dataUrl) clientVideoThumbnailCache.set(videoUrl, dataUrl);
                resolve(dataUrl);
            };

            const captureFrame = () => {
                try {
                    const width = video.videoWidth || 0;
                    const height = video.videoHeight || 0;
                    if (!width || !height) return finish(null);

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const context = canvas.getContext('2d');
                    if (!context) return finish(null);

                    context.drawImage(video, 0, 0, width, height);
                    finish(canvas.toDataURL('image/jpeg', 0.92));
                } catch {
                    finish(null);
                }
            };

            const pollFrame = () => {
                if (settled) return;

                const hasFrame = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
                const reachedTarget = Math.abs(video.currentTime - targetTime) <= 0.15 || video.currentTime > targetTime;
                if (hasFrame && reachedTarget && video.videoWidth > 0 && video.videoHeight > 0) {
                    captureFrame();
                    return;
                }

                if (performance.now() - startedAt >= timeoutMs) {
                    finish(null);
                    return;
                }

                window.requestAnimationFrame(pollFrame);
            };

            const timer = window.setTimeout(() => finish(null), timeoutMs + 50);

            video.crossOrigin = 'anonymous';
            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';
            video.style.position = 'fixed';
            video.style.left = '-9999px';
            video.style.top = '0';
            video.style.width = '1px';
            video.style.height = '1px';
            video.style.opacity = '0';
            video.style.pointerEvents = 'none';
            video.onerror = () => finish(null);
            video.onloadeddata = () => {
                const duration = Number.isFinite(video.duration) ? video.duration : 0;
                targetTime = duration > 0
                    ? Math.min(Math.max(seekSeconds, 0.1), Math.max(duration - 0.1, 0.1))
                    : seekSeconds;
                startedAt = performance.now();

                if (duration > 0 && Math.abs(video.currentTime - targetTime) > 0.05) {
                    try {
                        video.currentTime = targetTime;
                    } catch {
                    }
                }

                pollFrame();
            };

            document.body.appendChild(video);
            video.src = videoUrl;
            video.load();
        });
    }

    async function prefetchClientVideoThumbnails(post: FediversePost | null, origin: string): Promise<void> {
        if (!post) return;

        const candidates = post.attachments.filter(att =>
            (att.type === 'video' || att.type === 'gifv')
            && (att as any).__needsClientThumbnail
            && typeof att.url === 'string'
            && att.url
        );

        if (candidates.length === 0) return;

        await Promise.all(candidates.map(async att => {
            const videoUrl = att.url as string;
            const captureUrl = buildVideoProxyUrl(origin, videoUrl);
            const candidatePreviewUrl = typeof (att as any).__candidatePreviewUrl === 'string' && (att as any).__candidatePreviewUrl
                ? (att as any).__candidatePreviewUrl
                : typeof (att as any).__fallbackPreviewUrl === 'string' && (att as any).__fallbackPreviewUrl
                    ? (att as any).__fallbackPreviewUrl
                    : (typeof att.previewUrl === 'string' ? att.previewUrl : '');

            if (candidatePreviewUrl) {
                const proxiedPreviewUrl = buildImageProxyUrl(origin, candidatePreviewUrl);
                const previewReady = await probeVideoPreviewImage(buildImageProbeUrl(origin, candidatePreviewUrl));
                if (previewReady) {
                    att.previewUrl = proxiedPreviewUrl;
                    (att as any).__directPreviewReady = true;
                    return;
                }
            }

            const dataUrl = await captureClientVideoThumbnail(captureUrl, 0.8, 4000);
            if (dataUrl) {
                imageMap[videoUrl] = dataUrl;
                (att as any).__clientThumbnailReady = true;
                return;
            }

            att.previewUrl = candidatePreviewUrl
                ? buildImageProxyUrl(origin, candidatePreviewUrl)
                : `${origin}/api/video-thumbnail?url=${encodeURIComponent(videoUrl)}&t=0.8`;
        }));
    }

    // Content warning animation state management
    let contentWarningAnimationState = {
        isAnimating: false,
        lastContent: '',
        debounceTimer: null as ReturnType<typeof setTimeout> | null,
        isContentLoading: false
    };

    generateBtn?.addEventListener('click', fetchFediversePost);
    ['input', 'focus', 'change'].forEach(event => {
        urlInput?.addEventListener(event, toggleClearButtonVisibility);
    });
    urlInput?.addEventListener('paste', () => setTimeout(toggleClearButtonVisibility, 0));
    clearUrlBtn?.addEventListener('click', clearUrlInput);
    toggleClearButtonVisibility();
    downloadBtn?.addEventListener('click', () => imageGenerator.generateAndDownload().catch(err => {
        showError('Image generation failed.');
        // Reset download button state on error
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download Image';
        }
    }));
    copyBtn?.addEventListener('click', () => imageGenerator.generateAndCopy().catch(err => {
        showError('Copy to clipboard failed.');
        // Reset copy button state on error
        if (copyBtn) {
            copyBtn.disabled = false;
            copyBtn.innerHTML = `
                <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Image
            `;
        }
    }));
    templateToggle?.addEventListener('click', () => templateManager.openModal());
    optionsToggle?.addEventListener('click', () => toggleAccordion(optionsContent, optionsIcon, optionsToggle));


    // Listen for template change events from templateManager
    document.addEventListener('templateChanged', () => {
        if (postData) renderPreview();
    });

    visibilityCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            visibilityCheckboxes.forEach(cb => {
                if (cb?.value) (visibility as any)[cb.value] = cb.checked;
            });
            if (postData) renderPreview();
        });
    });

    async function fetchFediversePost() {
        // Properly cleanup existing EventSource
        if (eventSource) {
            try {
                const oldEventSource = eventSource;
                eventSource = null; // Clear reference immediately

                // Remove event listeners before closing
                oldEventSource.onopen = null;
                oldEventSource.onmessage = null;
                oldEventSource.onerror = null;

                // Check state before closing
                if (oldEventSource.readyState !== EventSource.CLOSED) {
                    oldEventSource.close();
                }
            } catch (error) {
                console.warn('Error closing previous EventSource:', error);
            }
        }

        // Reset image tracking state
        loadedImageUrls.clear();
        failedImageUrls.clear();

        const url = urlInput?.value?.trim() || '';

        if (!url) {
            return showError('Please enter a URL');
        }

        if (previewArea) {
            previewArea.classList.remove('hidden');
            previewArea.classList.add('flex', 'flex-col');
        }
        setGenerateButtonState(true);
        setPreviewState('loading');
        if (previewStatus) {
            previewStatus.textContent = 'Fetching post...';
            previewStatus.className = 'text-sm text-blue-600';
        }

        try {
            // Use the Fediverse API to fetch the post
            const apiResponse = await fetch('/api/fetch-post', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url }),
            });

            if (!apiResponse.ok) {
                const errorData = await apiResponse.json().catch(() => ({ error: 'An unknown server error occurred' }));
                const errorMessage = errorData.error || `Server error: ${apiResponse.statusText}`;
                const suggestion = errorData.suggestion ? `\n\n💡 ${errorData.suggestion}` : '';
                throw new Error(`${errorMessage}${suggestion}`);
            }

            const responseData = await apiResponse.json();

            // Use the actual post data from the API
            postData = responseData.postData;

            // Use the image map from the server response if available
            if (responseData.imageMap) {
                imageMap = responseData.imageMap;
            } else {
                // Initialize empty image map
                imageMap = {};
            }

            // Extract instance domain from response or URL
            fetchedInstance = responseData.fetchedInstance || new URL(url).hostname;

            // Show/hide content warning controls based on post sensitivity
            if (contentWarningToggleContainer && postData) {
                if (postData.sensitive || postData.spoilerText) {
                    contentWarningToggleContainer.classList.remove('hidden');
                } else {
                    contentWarningToggleContainer.classList.add('hidden');
                }
            }
            if (quoteToggleContainer && postData) {
                if (postData.quotedPost) {
                    quoteToggleContainer.classList.remove('hidden');
                } else {
                    quoteToggleContainer.classList.add('hidden');
                }
            }
            let imageUrls: string[] = [];
            const origin = window.location.origin;
            await prefetchClientVideoThumbnails(postData, origin);
            const collectVideoThumbUrls = (post: FediversePost | null): string[] => {
                if (!post) return [];
                return post.attachments.flatMap(att => {
                    if (att.type !== 'video' && att.type !== 'gifv') return [];
                    if ((att as any).__clientThumbnailReady) return [];
                    if ((att as any).__directPreviewReady) return [];
                    if (att.previewUrl) return [att.previewUrl];
                    if ((att as any).__needsClientThumbnail) return [];
                    if (typeof att.url === 'string' && att.url) {
                        return [`${origin}/api/video-thumbnail?url=${encodeURIComponent(att.url)}&t=0.8`];
                    }
                    return [];
                });
            };

            if (responseData.imageUrls && responseData.imageUrls.length > 0) {
                imageUrls = responseData.imageUrls;
                // Ensure video thumbnails are included so preview waits for them.
                const videoThumbs = collectVideoThumbUrls(postData);
                if (videoThumbs.length > 0) {
                    const existing = new Set(imageUrls);
                    for (const url of videoThumbs) {
                        if (!existing.has(url)) imageUrls.push(url);
                    }
                }
            } else if (postData) {
                // Otherwise collect image URLs from the post data
                imageUrls = [
                    ...postData.attachments.flatMap(att => {
                        if (att.type === 'image') return [att.url];
                        if (att.type === 'video' || att.type === 'gifv') {
                            if ((att as any).__clientThumbnailReady) return [];
                            if ((att as any).__directPreviewReady) return [];
                            if (att.previewUrl) return [att.previewUrl];
                            if ((att as any).__needsClientThumbnail) return [];
                            if (typeof att.url === 'string' && att.url) {
                                return [`${origin}/api/video-thumbnail?url=${encodeURIComponent(att.url)}&t=0.8`];
                            }
                        }
                        return [];
                    }),
                    ...(postData.account.avatar ? [postData.account.avatar] : []),
                    ...postData.account.emojis.map(emoji => emoji.url)
                ].flat().filter(Boolean) as string[];
            }

            // Show/hide content warning controls based on post sensitivity
            if (contentWarningToggleContainer && postData) {
                if (postData.sensitive || postData.spoilerText) {
                    contentWarningToggleContainer.classList.remove('hidden');
                } else {
                    contentWarningToggleContainer.classList.add('hidden');
                }
            }
            if (quoteToggleContainer && postData) {
                if (postData.quotedPost) {
                    quoteToggleContainer.classList.remove('hidden');
                } else {
                    quoteToggleContainer.classList.add('hidden');
                }
            }

            // Don't render preview yet, wait for all images to load first
            if (imageUrls.length === 0) {
                renderPreview();
                if(downloadBtn) downloadBtn.disabled = false;
                if(copyBtn) copyBtn.disabled = false;
                setGenerateButtonState(false);
                return;
            }

            // Show loading state while waiting for images
            setPreviewState('loading');
            if (previewStatus) {
                previewStatus.textContent = `Loading images (0/${imageUrls.length})...`;
            }
            if (downloadBtn) downloadBtn.disabled = true;
            if (copyBtn) copyBtn.disabled = true;

            if (imageUrls.length === 0) {
                if (previewStatus) {
                    previewStatus.textContent = 'Preview loaded successfully';
                    previewStatus.className = 'text-sm text-green-600';
                }
                if(downloadBtn) downloadBtn.disabled = false;
                if(copyBtn) copyBtn.disabled = false;
                setGenerateButtonState(false);
                return;
            }

            if (previewStatus) {
                previewStatus.textContent = `Loading images (0/${imageUrls.length})...`;
            }

            // IMPORTANT: stream-images expects each URL to be encoded, then joined with commas.
            // Do not encode the whole joined string, or commas become %2C and cannot be split server-side.
            const encodedUrls = imageUrls.map(u => encodeURIComponent(u)).join(',');
            eventSource = new EventSource(`/api/stream-images?urls=${encodedUrls}`);
            let loadedImages = 0;
            const totalImages = imageUrls.length;

            eventSource.onmessage = (event) => {
                const data: StreamedImageData = JSON.parse(event.data);
                if (data.url) {
                    if (data.dataUrl && data.dataUrl !== 'failed') {
                        imageMap[data.url] = data.dataUrl;
                        loadedImageUrls.add(data.url);
                    } else {
                        failedImageUrls.add(data.url);
                    }
                }

                const loadedCount = loadedImageUrls.size;
                const failedCount = failedImageUrls.size;
                const processedCount = loadedCount + failedCount;

                if (previewStatus) {
                    previewStatus.textContent = `Loading images (${processedCount}/${totalImages})...`;
                    previewStatus.className = 'text-sm text-yellow-600';
                }

                // Check if all required images have been processed (loaded or failed)
                if (processedCount >= totalImages) {
                    handleStreamEnd();
                }
            };

            const handleStreamEnd = () => {
                // Clean up EventSource connection properly
                if (eventSource) {
                    try {
                        eventSource.close();
                        // Remove all event listeners to prevent memory leaks
                        eventSource.onopen = null;
                        eventSource.onmessage = null;
                        eventSource.onerror = null;
                    } catch (error) {
                        console.warn('Error closing EventSource:', error);
                    } finally {
                        eventSource = null;
                    }
                }

                // Reset render state first to ensure fresh start
                isRendering = false;
                pendingRender = false;

                // Now render everything at once with all images loaded
                // Wrap in try-catch to prevent state corruption on render errors
                try {
                    renderPreview();
                } catch (renderError) {
                    console.error('Preview render failed:', renderError);
                    showError('Failed to render preview. Please try again.');
                }

                // Show preview content with fade-in effect
                setPreviewState('content');

                if (previewStatus && previewStatus.textContent?.includes('Loading')) {
                    previewStatus.textContent = 'Preview loaded successfully';
                    previewStatus.className = 'text-sm text-green-600';
                }
                if(downloadBtn) downloadBtn.disabled = false;
                if(copyBtn) copyBtn.disabled = false;
                setGenerateButtonState(false);
            };

            eventSource.onerror = (err) => {
                console.error("EventSource failed:", err);

                const currentEventSource = eventSource;
                if (!currentEventSource) return; // Already cleaned up

                // Check connection state
                if (currentEventSource.readyState === EventSource.CLOSED) {
                    eventSource = null;
                    return; // Connection already closed
                }

                try {
                    currentEventSource.close();
                    currentEventSource.onopen = null;
                    currentEventSource.onmessage = null;
                    currentEventSource.onerror = null;
                } catch (e) {
                    console.warn('Error during EventSource cleanup:', e);
                } finally {
                    eventSource = null;
                }

                // Fallback: Render with whatever images we have
                if (loadedImageUrls.size > 0 || failedImageUrls.size > 0) {
                    isRendering = false;
                    pendingRender = false;
                    renderPreview();

                    if (previewStatus) {
                        const loadedCount = loadedImageUrls.size;
                        const failedCount = failedImageUrls.size;
                        previewStatus.textContent = `Preview loaded with ${loadedCount} images${failedCount > 0 ? ` (${failedCount} failed)` : ''}`;
                        previewStatus.className = 'text-sm text-yellow-600';
                    }
                    if(downloadBtn) downloadBtn.disabled = false;
                    if(copyBtn) copyBtn.disabled = false;
                    setGenerateButtonState(false);
                } else {
                    handleStreamEnd();
                }
            };

        } catch (error) {
            showError(error instanceof Error ? error.message : 'An unknown error occurred');
            postData = null;
            setGenerateButtonState(false);
        }
    }


    /**
     * Renders the entire preview card based on the current postData and visibility settings.
     * This function is the single source of truth for updating the preview UI.
     */
    function renderPreview() {
        if (!postData || !styleAContainer) {
            // Reset render state on early return to prevent deadlock
            isRendering = false;
            return;
        }

        // Prevent concurrent rendering
        if (isRendering) {
            pendingRender = true;
            return;
        }

        isRendering = true;
        pendingRender = false;

        // Use the current post's data (no reblog handling for now as most platforms handle this differently)
        const sourcePost: FediversePost = postData;

        if (contentWarningBanner && contentWarningText) {
            const hasContent = sourcePost.sensitive || !!sourcePost.spoilerText;
            const warningText = sourcePost.spoilerText || 'Sensitive content';
            const shouldShow = hasContent && visibility.contentWarning;

            // Clear any existing debounce timer
            if (contentWarningAnimationState.debounceTimer) {
                clearTimeout(contentWarningAnimationState.debounceTimer);
            }

            // Check if content has actually changed
            const contentChanged = contentWarningAnimationState.lastContent !== warningText;

            // If we're currently animating and content hasn't changed, skip
            if (contentWarningAnimationState.isAnimating && !contentChanged) {
                return;
            }

            // Update the last content
            contentWarningAnimationState.lastContent = warningText;

            // Use debounce to prevent rapid re-triggering during image loading
            const delay = contentChanged ? 0 : 100;
            contentWarningAnimationState.debounceTimer = setTimeout(() => {
                updateContentWarningBanner(contentWarningBanner, contentWarningText, warningText, shouldShow);
            }, delay as number); // Immediate if content changed, debounced if just re-rendering
        }

    function updateContentWarningBanner(banner: HTMLElement, textElement: HTMLElement, warningText: string, shouldShow: boolean) {
        contentWarningAnimationState.isAnimating = true;

        if (shouldShow) {
            textElement.textContent = warningText;

            if (!banner.classList.contains('hidden') && banner.classList.contains('cw-visible')) {
                contentWarningAnimationState.isAnimating = false;
                return;
            }

            banner.classList.remove('hidden');
            banner.classList.add('cw-expanding');

            void banner.offsetHeight; // Force reflow

            requestAnimationFrame(() => {
                banner.classList.remove('cw-expanding');
                banner.classList.add('cw-visible');

                banner.addEventListener('transitionend', function handler() {
                    contentWarningAnimationState.isAnimating = false;
                    banner.removeEventListener('transitionend', handler);
                }, { once: true });
            });

        } else {
            // Collapse the banner
            if (banner.classList.contains('hidden')) {
                contentWarningAnimationState.isAnimating = false;
                return;
            }

            banner.classList.add('cw-collapsing');

            requestAnimationFrame(() => {
                banner.classList.remove('cw-visible');

                banner.addEventListener('transitionend', function handler() {
                    banner.classList.add('hidden');
                    banner.classList.remove('cw-collapsing');
                    contentWarningAnimationState.isAnimating = false;
                    banner.removeEventListener('transitionend', handler);
                }, { once: true });
            });
        }
    }

        // Special handling for PeerTube videos - show video title prominently
        let contentHTML = sourcePost.content;
        let isPeerTubeVideo = false;

        if (sourcePost.platform === 'peertube' && sourcePost.attachments.length > 0) {
            isPeerTubeVideo = true;
            const videoAttachment = sourcePost.attachments[0];
            const videoTitle = videoAttachment.description || 'Video';
            // For PeerTube, use ONLY the video title as content (no description)
            contentHTML = `<div class="text-xl font-bold mb-3">${videoTitle}</div>`;
        }

        // If post quotes another post, strip the inline RE: link from main content
        if (sourcePost.quotedPost && typeof contentHTML === 'string') {
            contentHTML = contentHTML.replace(/<p\s+class=["']quote-inline["'][^>]*>[\s\S]*?<\/p>/gi, '');
            contentHTML = contentHTML.replace(/^(\s*<p[^>]*>)?\s*RE:\s*<a[^>]*href=["'][^"']*["'][^>]*>[\s\S]*?<\/a>(\s*<\/p>)?/gi, '');
        }

        // If content is Markdown or plain text, render it so the preview matches site output.
        if (typeof contentHTML === 'string') {
            const looksLikeHtmlTag = /<\/?[a-z][\w:-]*\b[^>]*>/i.test(contentHTML);
            const markdownHint = (text: string) => detectsMarkdown(text);

            if (!looksLikeHtmlTag) {
                // Plain text / Markdown (e.g. Misskey, Ech0, plain ActivityPub notes): render it (also linkifies bare URLs).
                contentHTML = renderMarkdownToHtml(contentHTML, { preferLinkHref: sourcePost.platform === 'ech0' });
            } else if (looksLikeHtmlTag) {
                // HTML-wrapped content: if it still looks like Markdown after stripping tags, re-render from textContent.
                const probe = document.createElement('div');
                probe.innerHTML = contentHTML;
                const text = (probe.textContent || '').replace(/\r\n?/g, '\n');
                const hasRichTags = /<(a|img|video|audio|ul|ol|li|blockquote|code|pre|strong|em|br)\b/i.test(contentHTML);

                if (hasRichTags) {
                    // Keep original HTML if it already contains rich elements.
                } else if (markdownHint(contentHTML)) {
                    // Render from original string to preserve inline HTML like <font>.
                    contentHTML = renderMarkdownToHtml(contentHTML, { preferLinkHref: sourcePost.platform === 'ech0' });
                } else if (markdownHint(text)) {
                    contentHTML = renderMarkdownToHtml(text, { preferLinkHref: sourcePost.platform === 'ech0' });
                }
            }
        }

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = sanitizeHtml(contentHTML);

        // Ech0 HTML output doesn't include Tailwind classes, so headings/code blocks can look like plain text.
        // Normalize common rich-text tags for better preview + snapdom output.
        if (sourcePost.platform === 'ech0') {
            tempDiv.querySelectorAll('h1').forEach(el => el.classList.add('mt-3', 'mb-1', 'text-xl', 'font-bold'));
            tempDiv.querySelectorAll('h2').forEach(el => el.classList.add('mt-3', 'mb-1', 'text-lg', 'font-bold'));
            tempDiv.querySelectorAll('h3').forEach(el => el.classList.add('mt-2', 'mb-1', 'text-base', 'font-semibold'));
            tempDiv.querySelectorAll('h4,h5,h6').forEach(el => el.classList.add('mt-2', 'mb-1', 'text-sm', 'font-semibold'));
            tempDiv.querySelectorAll('p').forEach(el => el.classList.add('leading-relaxed'));
            tempDiv.querySelectorAll('pre').forEach(el => el.classList.add('mt-2', 'mb-2', 'p-3', 'rounded', 'bg-gray-100', 'overflow-x-auto'));
            tempDiv.querySelectorAll('code').forEach(el => el.classList.add('font-mono', 'text-sm'));
            tempDiv.querySelectorAll('blockquote').forEach(el => el.classList.add('border-l-4', 'border-gray-300', 'pl-3', 'text-gray-700'));
            tempDiv.querySelectorAll('ul').forEach(el => el.classList.add('list-disc', 'pl-5'));
            tempDiv.querySelectorAll('ol').forEach(el => el.classList.add('list-decimal', 'pl-5'));
        }

        // Ech0 may include plain-text URLs (or markdown links) inside HTML without <a>.
        // Linkify text nodes so URLs are visible/styled in the final snapdom image.
        if (sourcePost.platform === 'ech0') {
            const textContent = tempDiv.textContent || '';
            const maybeHasUrlOrMdLink = /\bhttps?:\/\//i.test(textContent) || /\[[^\]]+?\]\((https?:\/\/[^)]+?)\)/i.test(textContent);

            if (maybeHasUrlOrMdLink) {
                const normalizeUrl = (rawUrl: string) => {
                    let url = rawUrl.trim();
                    // Trim common trailing punctuation, keeping balanced parentheses.
                    url = url.replace(/[.,;:!?]+$/, '');
                    while (url.endsWith(')')) {
                        const opens = (url.match(/\(/g) || []).length;
                        const closes = (url.match(/\)/g) || []).length;
                        if (closes > opens) url = url.slice(0, -1);
                        else break;
                    }
                    return url;
                };

                const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT);
                const textNodes: Text[] = [];
                let node: Node | null;

                while ((node = walker.nextNode())) {
                    if (node.nodeType !== Node.TEXT_NODE) continue;
                    const tn = node as Text;
                    const parent = tn.parentElement;
                    if (!parent) continue;
                    const tag = parent.tagName.toLowerCase();
                    if (tag === 'a' || tag === 'code' || tag === 'pre' || tag === 'script' || tag === 'style') continue;
                    textNodes.push(tn);
                }

                // Handle Markdown links and bare URLs, including URLs with parentheses.
                const mdOrUrl = /\[([^\]]+?)\]\((https?:\/\/[^\s]+?)\)|\bhttps?:\/\/[^\s<>"']+/gi;
                for (const tn of textNodes) {
                    const raw = tn.nodeValue || '';
                    if (!mdOrUrl.test(raw)) continue;
                    mdOrUrl.lastIndex = 0;

                    const frag = document.createDocumentFragment();
                    let last = 0;
                    let m: RegExpExecArray | null;

                    while ((m = mdOrUrl.exec(raw)) !== null) {
                        if (m.index > last) frag.appendChild(document.createTextNode(raw.slice(last, m.index)));

                        if (m[2]) {
                            // Markdown link: [text](url)
                            const href = normalizeUrl(m[2]);
                            const a = document.createElement('a');
                            a.href = href;
                            a.target = '_blank';
                            a.rel = 'nofollow noopener noreferrer';
                            a.classList.add('url');
                            a.textContent = href;
                            frag.appendChild(a);
                        } else {
                            // Bare URL
                            const href = normalizeUrl(m[0]);
                            const a = document.createElement('a');
                            a.href = href;
                            a.target = '_blank';
                            a.rel = 'nofollow noopener noreferrer';
                            a.classList.add('url');
                            a.textContent = href;
                            frag.appendChild(a);
                        }

                        last = m.index + m[0].length;
                    }

                    if (last < raw.length) frag.appendChild(document.createTextNode(raw.slice(last)));
                    tn.parentNode?.replaceChild(frag, tn);
                }
            }
        }

        // Remove a11y-only helper text to avoid duplicate visible text
        tempDiv.querySelectorAll('.sr-only, .sr-only-focusable, .visually-hidden, .visuallyhidden, .screen-reader-text, .a11y-only').forEach(node => {
            node.parentNode?.removeChild(node);
        });

        // Fix Mastodon's link display: unwrap .invisible and .ellipsis spans to show full URLs
        tempDiv.querySelectorAll('a').forEach(link => {
            const allSpans = Array.from(link.querySelectorAll('span.invisible, span.ellipsis'));
            allSpans.forEach(span => {
                const textNode = document.createTextNode(span.textContent || '');
                span.parentNode?.replaceChild(textNode, span);
            });
        });

        // Keep links in their original format for natural appearance
        tempDiv.querySelectorAll('a:not(.mention):not(.hashtag)').forEach(link => {
            // Ensure links have proper styling
            link.classList.add('text-blue-600', 'hover:text-blue-800');
        });

        // Ech0: show real URLs and remove adjacent duplicates caused by cards/titles.
        if (sourcePost.platform === 'ech0') {
            // Keep Bilibili links as plain text; linkCards are not rendered as cards.

            const normalizeForDedupe = (href: string) => {
                try {
                    const u = new URL(href);
                    // Remove hash only; keep other params to avoid over-normalization.
                    u.hash = '';
                    return u.toString();
                } catch {
                    return href.trim();
                }
            };

            // Collect links and keep original text; avoid aggressive dedupe.
            const links = Array.from(tempDiv.querySelectorAll<HTMLAnchorElement>('a:not(.mention):not(.hashtag)'));

            for (const link of links) {
                const href = link.href || '';
                if (!href) continue;

                // Preserve descriptive link text when available.
                const currentText = link.textContent?.trim() || '';
                const isUrlOnly = currentText === href ||
                    currentText.startsWith('http') ||
                    currentText.length < 5; // Very short text is likely truncated.

                // Replace with full URL only when text is a URL or clearly invalid.
                if (isUrlOnly) {
                    link.textContent = href;
                }
                // Otherwise keep the original text.
            }

            // Ech0: do not render extension as a card; keep it as plain text links.

            // Ech0: remove adjacent duplicate links (same href + text) to avoid a11y duplication.
            const removeAdjacentDuplicateLinks = (root: HTMLElement) => {
                const parents = Array.from(root.querySelectorAll<HTMLElement>('*'));
                parents.push(root);

                for (const parent of parents) {
                    const children = Array.from(parent.childNodes);
                    for (let i = 0; i < children.length - 1; i++) {
                        const current = children[i];
                        if (!(current instanceof HTMLAnchorElement)) continue;

                        // Skip whitespace text nodes between anchors
                        let j = i + 1;
                        while (j < children.length && children[j].nodeType === Node.TEXT_NODE && !children[j].nodeValue?.trim()) {
                            j++;
                        }
                        if (j >= children.length) break;

                        const next = children[j];
                        if (!(next instanceof HTMLAnchorElement)) continue;

                        const sameHref = (current.href || '') === (next.href || '');
                        const sameText = (current.textContent || '').trim() === (next.textContent || '').trim();
                        if (sameHref && sameText) {
                            next.parentNode?.removeChild(next);
                            // Keep index at current to catch consecutive duplicates
                            children.splice(j, 1);
                        }
                    }
                }
            };

            removeAdjacentDuplicateLinks(tempDiv);
        }

        // Convert and style unlinked hashtags in text nodes (e.g. Misskey, plain text notes)
        if (Array.isArray(sourcePost.tags) && sourcePost.tags.length > 0) {
            const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT);
            const textNodes: Text[] = [];
            let node: Node | null;
            while ((node = walker.nextNode())) {
                const parent = node.parentElement;
                if (parent && parent.tagName.toLowerCase() !== 'a' && parent.tagName.toLowerCase() !== 'code' && parent.tagName.toLowerCase() !== 'pre') {
                    textNodes.push(node as Text);
                }
            }

            sourcePost.tags.forEach(t => {
                const cleanName = (t.name || '').replace(/^#/, '').trim();
                if (!cleanName) return;
                const tagUrl = t.url || `#/tags/${encodeURIComponent(cleanName)}`;
                const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(^|[\\s\\(\\[\\{<（【《「“"‘/])#(${escaped})(?=$|[\\s\\)\\]\\}>）】》」”"’.,!?:;，。！？/])`, 'gi');

                textNodes.forEach(tn => {
                    if (!tn.parentNode) return;
                    const val = tn.nodeValue || '';
                    if (regex.test(val)) {
                        regex.lastIndex = 0;
                        const span = document.createElement('span');
                        span.innerHTML = val.replace(regex, (_m, prefix, tag) => {
                            return `${prefix}<a href="${tagUrl}" target="_blank" rel="nofollow noopener noreferrer" class="mention hashtag inline-block text-blue-600 hover:text-blue-800 font-medium">#${tag}</a>`;
                        });
                        tn.parentNode.replaceChild(span, tn);
                    }
                });
            });
        }

        // Style hashtags in content to make them more visible
        tempDiv.querySelectorAll('a.hashtag').forEach(hashtag => {
            hashtag.classList.add('inline-block', 'text-blue-600', 'hover:text-blue-800', 'font-medium');
        });

        // Do not render extension as a card; append the extension URL to content as a link.
        const ext = (sourcePost as any).extension as { type?: string; url?: string } | undefined;
        const extUrl = typeof ext?.url === 'string' ? ext.url.trim() : '';

        if (sourcePost.platform === 'ech0' && extUrl) {
            // Skip if the content already contains this URL.
            const contentHasUrl = tempDiv.textContent?.includes(extUrl) ||
                                  tempDiv.innerHTML?.includes(extUrl);

            if (!contentHasUrl) {
                // Append the extension URL as a link at the end of content.
                const lineBreak = document.createElement('br');
                tempDiv.appendChild(lineBreak);

                const extLink = document.createElement('a');
                extLink.href = extUrl;
                extLink.target = '_blank';
                extLink.rel = 'nofollow noopener noreferrer';
                extLink.classList.add('url', 'text-blue-600', 'hover:text-blue-800', 'mt-1', 'inline-block');
                extLink.textContent = extUrl;
                tempDiv.appendChild(extLink);
            }
        }

        contentHTML = tempDiv.innerHTML;

        const rawAccountEmojis = sourcePost.account?.emojis || [];
        const rawPostEmojis = (sourcePost as any).emojis || [];
        const allEmojis = [...rawAccountEmojis];
        rawPostEmojis.forEach((emoji: any) => {
            if (!allEmojis.find((e: any) => e.shortcode === emoji.shortcode)) {
                allEmojis.push(emoji);
            }
        });

        /**
         * Optimized emoji replacement supporting extended shortcodes (hyphens, dots, @, etc.)
         */
        function replaceEmojis(content: string, emojis: typeof allEmojis): string {
            if (!emojis || emojis.length === 0 || !content) return content;
            const emojiMap = new Map<string, string>();

            emojis.forEach(emoji => {
                const dataUrl = imageMap[emoji.url];
                let imgTag: string;
                const safeShortcode = escapeHtml(emoji.shortcode);
                const safeUrl = escapeHtml(emoji.url);

                if (dataUrl && dataUrl !== 'failed') {
                    imgTag = `<img src="${escapeHtml(dataUrl)}" alt=":${safeShortcode}:" class="custom-emoji inline-block w-5 h-5 align-text-bottom">`;
                } else if (imageMap[emoji.url] === undefined) {
                    imgTag = `<img src="${safeUrl}" alt=":${safeShortcode}:" class="custom-emoji inline-block w-5 h-5 align-text-bottom" onerror="this.onerror=null; this.outerHTML=':${safeShortcode}:'">`;
                } else {
                    imgTag = `:${safeShortcode}:`;
                }

                emojiMap.set(emoji.shortcode.toLowerCase(), imgTag);
            });

            return content.replace(/:([a-zA-Z0-9_~@.+-]+):/g, (match, shortcode) => {
                return emojiMap.get(shortcode.toLowerCase()) || match;
            });
        }

        contentHTML = replaceEmojis(contentHTML, allEmojis);

        // Escape displayName first, then apply emoji replacement
        let displayNameHTML = escapeHtml(sourcePost.account.displayName || '');
        displayNameHTML = replaceEmojis(displayNameHTML, allEmojis);

        const tagsContainer = document.getElementById('tags-container') as HTMLDivElement | null;
        if (tagsContainer) {
            tagsContainer.innerHTML = '';
            tagsContainer.classList.add('hidden');

            const contentHashtagNames = new Set<string>();
            tempDiv.querySelectorAll('a').forEach(a => {
                const isHashtagLink = a.classList.contains('hashtag') || /\/tags\//i.test(a.href || '') || (a.getAttribute('rel') || '').includes('tag');
                if (isHashtagLink) {
                    const cleanText = (a.textContent || '').replace(/^#/, '').trim().toLowerCase();
                    if (cleanText) contentHashtagNames.add(cleanText);
                    try {
                        const urlObj = new URL(a.href);
                        const pathTag = decodeURIComponent(urlObj.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();
                        if (pathTag) contentHashtagNames.add(pathTag);
                    } catch {}
                }
            });

            const contentTextLower = (tempDiv.textContent || '').toLowerCase();
            const hashtagTags = (Array.isArray(sourcePost.tags) ? sourcePost.tags.filter(t => t.type === 'hashtag') : [])
                .filter(t => {
                    const cleanName = (t.name || '').replace(/^#/, '').trim().toLowerCase();
                    if (!cleanName) return false;
                    if (contentHashtagNames.has(cleanName)) return false;
                    if (contentTextLower.includes('#' + cleanName)) return false;
                    return true;
                });

            if (hashtagTags.length > 0) {
                const wrap = document.createElement('div');
                wrap.className = 'flex flex-wrap gap-1';

                hashtagTags.slice(0, 12).forEach(t => {
                    const a = document.createElement('a');
                    a.href = t.url;
                    a.target = '_blank';
                    a.rel = 'nofollow noopener noreferrer';
                    a.textContent = `#${(t.name || '').replace(/^#/, '').trim()}`;
                    a.className = 'inline-block text-blue-600 hover:text-blue-800 font-medium hashtag';
                    wrap.appendChild(a);
                });

                tagsContainer.appendChild(wrap);
                tagsContainer.classList.remove('hidden');
            }
        }

        const quotedContainer = document.getElementById('quoted-post-container') as HTMLDivElement | null;
        if (quotedContainer) {
            quotedContainer.classList.add('quoted-post-card');

            if (sourcePost.quotedPost) {
                if (!quotedContainer.querySelector('.quoted-post-inner')) {
                    const qPost = sourcePost.quotedPost;
                    const qAvatar = imageMap[qPost.account?.avatar || ''] || qPost.account?.avatar || '';
                    let qDisplayName = escapeHtml(qPost.account?.displayName || qPost.account?.username || '');
                    const qAcct = escapeHtml(qPost.account?.acct?.includes('@') ? `@${qPost.account.acct}` : `@${qPost.account?.acct || ''}`);

                    let qContent = qPost.content || '';
                    const qEmojis = [...(qPost.account?.emojis || []), ...((qPost as any).emojis || [])];
                    qDisplayName = replaceEmojis(qDisplayName, qEmojis);
                    qContent = replaceEmojis(qContent, qEmojis);

                    quotedContainer.className = 'quoted-post-card mt-3 rounded-xl border border-brand-gray-200 bg-gray-50/80 dark:bg-gray-800/50 p-3.5 space-y-2';
                    quotedContainer.innerHTML = `
                        <div class="quoted-post-inner space-y-2">
                            <div class="flex items-center gap-2.5">
                                ${qAvatar ? `<img class="w-8 h-8 rounded-lg object-cover ring-1 ring-black/5" src="${escapeHtml(qAvatar)}" alt="${qDisplayName}">` : `<div class="w-8 h-8 rounded-lg bg-gray-300 flex items-center justify-center text-xs text-gray-600 font-bold">?</div>`}
                                <div class="min-w-0 flex-1 leading-tight">
                                    <div class="font-bold text-sm text-primary truncate">${qDisplayName}</div>
                                    <div class="text-xs text-secondary truncate mt-0.5">${qAcct}</div>
                                </div>
                            </div>
                            <div class="text-sm text-primary/90 leading-relaxed">${sanitizeHtml(qContent)}</div>
                            ${renderQuotedMedia(qPost.attachments, imageMap)}
                        </div>
                    `;
                }

                if (visibility.quote) {
                    quotedContainer.classList.remove('hidden', 'quote-collapsed');
                    quotedContainer.classList.add('quote-expanded');
                } else {
                    quotedContainer.classList.remove('quote-expanded');
                    quotedContainer.classList.add('quote-collapsed');
                }
            } else {
                quotedContainer.innerHTML = '';
                quotedContainer.classList.add('hidden', 'quote-collapsed');
                quotedContainer.classList.remove('quote-expanded');
            }
        }

        if (extensionContainer) {
            extensionContainer.innerHTML = '';
            extensionContainer.classList.add('hidden');
            extensionContainer.className = 'mt-3 hidden';
        }

        let avatarHTML = '';


        // Use the real user avatar directly
        if (sourcePost.account.avatar) {


            // If we have the avatar loaded from imageMap, use it
            if (imageMap[sourcePost.account.avatar] && imageMap[sourcePost.account.avatar] !== 'failed') {
                avatarHTML = `<img class="w-12 h-12 rounded-lg object-cover" alt="Avatar" src="${imageMap[sourcePost.account.avatar]}" onerror="this.src='${sourcePost.account.avatar}'">`;
            }
            // If avatar loading failed or not in imageMap yet, try direct URL
            else {

                avatarHTML = `<img class="w-12 h-12 rounded-lg object-cover" alt="Avatar" src="${sourcePost.account.avatar}" onerror="this.style.display='none'">`;
            }
        } else {

            avatarHTML = `<div class="w-12 h-12 rounded-lg bg-gray-300 flex items-center justify-center text-gray-600 text-sm font-medium">?</div>`;
        }

        // Render avatar and user info first
        const avatarContainerEl = document.getElementById(DOM_ELEMENT_IDS.AVATAR_CONTAINER) as HTMLDivElement;
        const displayNameEl = document.getElementById(DOM_ELEMENT_IDS.DISPLAY_NAME) as HTMLDivElement;
        const usernameEl = document.getElementById(DOM_ELEMENT_IDS.USERNAME) as HTMLDivElement;

        avatarContainerEl.innerHTML = avatarHTML;
        displayNameEl.innerHTML = displayNameHTML;

        // Construct the username, optionally including the instance name based on visibility settings.
        const { acct } = sourcePost.account;
        const usernamePart = acct.includes('@') ? acct.split('@')[0] : acct;
        const instancePart = acct.includes('@') ? acct.split('@').slice(1).join('@') : fetchedInstance;
        const cleanUser = escapeHtml(usernamePart);
        const cleanInst = escapeHtml(instancePart);
        usernameEl.innerHTML = `<span>@${cleanUser}</span>${cleanInst ? `<span class="instance-part ${visibility.instance ? 'instance-visible' : 'instance-hidden'}">@${cleanInst}</span>` : ''}`;


        // Inject the processed content into the DOM AFTER user info is rendered.
        // Ech0 Markdown renderer outputs multiple <p> blocks; our global stylesheet gives <p> a large bottom margin
        // which can look like "extra blank lines" in the generated image. Tag the container so CSS can tune spacing.
        const contentEl = document.getElementById(DOM_ELEMENT_IDS.CONTENT) as HTMLDivElement;
        contentEl.classList.toggle('platform-ech0', sourcePost.platform === 'ech0');
        contentEl.innerHTML = sanitizeHtml(contentHTML);

        renderMedia(sourcePost.attachments, imageMap);

        // Render poll results if present
        // Cleanup old poll container (fixes persistence issue)
        const oldPollContainer = document.querySelector('.poll-container');
        if (oldPollContainer) {
            oldPollContainer.remove();
        }

        if (sourcePost.poll) {
            renderPoll(sourcePost.poll);
        }

        // Format the date and time for the footer display.
        const date = new Date(sourcePost.createdAt);
        const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const formattedTime = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        // Render the footer section, which includes stats and the timestamp.
        renderFooter(sourcePost, visibility, formattedTime, formattedDate);

        setPreviewState('content');

        // Reset render lock and check for pending render
        isRendering = false;
        if (pendingRender) {
            // Use setTimeout to avoid call stack issues
            setTimeout(() => renderPreview(), 0);
        }
    }
    /**
     * Renders media attachments for quoted posts with full aspect ratio preservation.
     */
    function renderQuotedMedia(attachments: FediverseAttachment[] | undefined, imgMap: Record<string, string>): string {
        if (!attachments || attachments.length === 0) return '';
        const toDisplay = attachments.slice(0, 4);
        const count = toDisplay.length;
        const gridCols = count === 1 ? 'grid-cols-1' : 'grid-cols-2';

        const itemsHtml = toDisplay.map(att => {
            const displayUrl = att.previewUrl || att.url;
            const src = imgMap[displayUrl] || displayUrl;
            const isVideo = att.type === 'video' || att.type === 'gifv';
            const hasAspect = att.width && att.height && count === 1;
            const aspectStyle = hasAspect
                ? `aspect-ratio: ${att.width} / ${att.height}; max-height: 480px;`
                : count > 1 ? `aspect-ratio: 16 / 10;` : `max-height: 420px;`;

            return `
                <div class="relative overflow-hidden rounded-lg bg-gray-100" style="${aspectStyle}">
                    <img class="w-full h-full object-cover" src="${escapeHtml(src)}" alt="${escapeHtml(att.description || 'Media')}">
                    ${isVideo ? `
                        <div class="absolute top-2 right-2 bg-black/70 text-white text-[11px] font-medium px-2 py-0.5 rounded flex items-center gap-1 z-10 backdrop-blur-xs">
                            <svg class="w-3 h-3 fill-current" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v8a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z"/></svg>
                            ${att.type === 'gifv' ? 'GIF' : 'Video'}
                        </div>` : ''}
                </div>
            `;
        }).join('');

        return `
            <div class="mt-2.5 grid ${gridCols} gap-1.5 rounded-lg overflow-hidden border border-brand-gray-200">
                ${itemsHtml}
            </div>
        `;
    }
    /**
     * Renders media attachments (images/videos) into the preview card.
     * @param attachments - The list of media attachments from the post.
     * @param imgMap - A map of image URLs to their Base64 data URLs.
     */
    function renderMedia(attachments: FediverseAttachment[], imgMap: Record<string, string>) {
        const container = document.getElementById(DOM_ELEMENT_IDS.ATTACHMENT) as HTMLDivElement;
        if (!container) return;
        container.innerHTML = '';
        container.className = 'mt-3 rounded-lg overflow-hidden border border-brand-gray-200 bg-gray-100';

        if (!attachments || attachments.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'grid';
        container.classList.add('gap-px');
        const toDisplay = attachments.slice(0, 4);
        const hasMore = attachments.length > 4;

        // Check if there are any videos or GIFs in the attachments
        const hasVideosOrGifs = toDisplay.some(att => att.type === 'video' || att.type === 'gifv');

        // Compute grid style (avoid 3/2 aspect ratio for single-image posts)
        const gridStyle = computeMediaGridStyle({ count: toDisplay.length, hasVideosOrGifs });
        container.style.gridTemplateColumns = gridStyle.columns;
        if (gridStyle.aspectRatio) {
            container.style.aspectRatio = gridStyle.aspectRatio;
        } else {
            container.style.removeProperty('aspect-ratio');
        }

        toDisplay.forEach((att, index) => {
            // For videos and GIFs, use preview URL; for images, use the main URL
            let url = att.url;
            let previewUrl = att.previewUrl;

            // Choose the appropriate URL for display
            let displayUrl = url;
            if (att.type === 'video' || att.type === 'gifv') {
                // For videos, prefer preview URL if available
                displayUrl = previewUrl || url;
            }

            // Try to get the data URL from imageMap
            let dataUrl = imgMap[displayUrl];

            // If preview URL didn't work, try the main URL
            if (!dataUrl && previewUrl && att.type === 'video') {
                dataUrl = imgMap[url];
                displayUrl = url;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'overflow-hidden relative';
            wrapper.dataset.attachmentIndex = String(index);
            wrapper.dataset.mediaType = att.type;

            if (dataUrl && dataUrl !== 'failed') {
                wrapper.innerHTML = `<img alt="${att.description || `Attachment ${index + 1}`}" class="w-full h-full object-cover" src="${dataUrl}">`;
            }
            else if ((att.type === 'video' || att.type === 'gifv') && previewUrl) {
                wrapper.innerHTML = `<img alt="${att.description || `Video ${index + 1}`}" class="w-full h-full object-cover" src="${previewUrl}">`;
            }
            else if ((att.type === 'video' || att.type === 'gifv') && !previewUrl && url) {
                const serverThumb = `/api/video-thumbnail?url=${encodeURIComponent(url)}&t=0.8`;
                wrapper.innerHTML = `<img alt="${att.description || `Video ${index + 1}`}" class="w-full h-full object-cover" src="${serverThumb}" onerror="this.parentElement.innerHTML = '<div class=\'w-full h-full bg-gray-200 flex items-center justify-center text-gray-500\'><svg class=\'w-8 h-8 text-gray-400\' fill=\'none\' stroke=\'currentColor\' viewBox=\'0 0 24 24\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z\'></path></svg></div>'">`;
            }
            else if ((att.type === 'video' || att.type === 'gifv') && (att as any).__needsClientThumbnail && url) {
                const serverThumb = `/api/video-thumbnail?url=${encodeURIComponent(url)}&t=0.8`;
                wrapper.innerHTML = `<img alt="${att.description || `Video ${index + 1}`}" class="w-full h-full object-cover" src="${serverThumb}" onerror="this.parentElement.innerHTML = '<div class=\'w-full h-full bg-gray-200 flex items-center justify-center text-gray-500\'><svg class=\'w-8 h-8 text-gray-400\' fill=\'none\' stroke=\'currentColor\' viewBox=\'0 0 24 24\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z\'></path></svg></div>'">`;
            } else if (dataUrl === 'failed') {
                // If image loading failed, try to use the original URL as fallback
                wrapper.innerHTML = `<img alt="${att.description || `Attachment ${index + 1}`}" class="w-full h-full object-cover" src="${displayUrl}" onerror="this.parentElement.innerHTML = '<div class=\'w-full h-full bg-gray-200 flex items-center justify-center text-gray-500\'><svg class=\'w-8 h-8 text-gray-400\' fill=\'none\' stroke=\'currentColor\' viewBox=\'0 0 24 24\'><path stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z\'></path></svg></div>'">`;
            } else {
                // Image is still loading, show shimmer animation
                wrapper.innerHTML = `<div class="w-full h-full shimmer"></div>`;
            }

            // Add overlay badges for video types
            if (att.type === 'gifv') wrapper.innerHTML += `<div class="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded z-10">GIF</div>`;
            if (att.type === 'video') wrapper.innerHTML += `<div class="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded flex items-center z-10"><svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v8a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z"/></svg>Video</div>`;

            // Add "more images" badge on the last image if there are more than 4
            if (hasMore && index === toDisplay.length - 1) {
                const moreCount = attachments.length - 4;
                wrapper.innerHTML += `<div class="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center z-10"><div class="text-white text-2xl font-bold">+${moreCount}</div></div>`;
            }

            if (toDisplay.length === 3 && index === 0) wrapper.style.gridRow = 'span 2 / span 2';

            container.appendChild(wrapper);
        });
    }

    /**
     * Renders poll results into the preview card.
     * @param poll - The poll data from the post.
     */
    function renderPoll(poll: FediversePoll) {
        if (!poll || !poll.options || poll.options.length === 0) return;

        // Create poll container
        const pollContainer = document.createElement('div');
        pollContainer.className = 'poll-container mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200';

        // Calculate total votes
        const totalVotes = poll.options.reduce((sum: number, opt: FediversePoll['options'][0]) => sum + opt.votes_count, 0);

        // Create options list
        const optionsList = document.createElement('div');
        optionsList.className = 'space-y-2';

        poll.options.forEach((option: any, index: number) => {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'flex items-center justify-between';

            // Calculate percentage
            const percentage = totalVotes > 0 ? Math.round((option.votes_count / totalVotes) * 100) : 0;

            // Create progress bar container - reduced margin to 1
            const progressContainer = document.createElement('div');
            progressContainer.className = 'flex-1 h-2 bg-gray-200 rounded mr-1';

            // Create progress fill
            const progressFill = document.createElement('div');
            progressFill.className = 'h-full bg-blue-500 rounded transition-all duration-300';
            progressFill.style.width = `${percentage}%`;
            progressContainer.appendChild(progressFill);

            // Create option text - reduced margin to 2
            const optionText = document.createElement('div');
            optionText.className = 'text-sm mr-2 flex-1';
            let optTitle = escapeHtml(option.title || '');
            optTitle = replaceEmojis(optTitle, allEmojis);
            optionText.innerHTML = optTitle;

            // Create votes text
            const votesText = document.createElement('div');
            votesText.className = 'text-xs text-gray-500';
            votesText.textContent = `${percentage}% (${option.votes_count} votes)`;

            // Assemble option
            optionDiv.appendChild(optionText);
            optionDiv.appendChild(progressContainer);
            optionDiv.appendChild(votesText);

            optionsList.appendChild(optionDiv);
        });

        // Create poll info - removed emojis
        const pollInfo = document.createElement('div');
        pollInfo.className = 'text-xs text-gray-500 mt-2';

        const totalText = `Total: ${poll.votes_count} votes`;
        const deadlineText = poll.expired
            ? 'Voting closed'
            : poll.expires_at
            ? `Ends: ${new Date(poll.expires_at).toLocaleDateString()}`
            : 'Ends: No deadline';

        pollInfo.textContent = `${totalText} | ${deadlineText}`;

        // Assemble poll container - removed pollTitle
        pollContainer.appendChild(optionsList);
        pollContainer.appendChild(pollInfo);

        // Insert poll after content
        const contentEl = document.getElementById(DOM_ELEMENT_IDS.CONTENT) as HTMLDivElement;
        if (contentEl.parentNode) {
            contentEl.parentNode.insertBefore(pollContainer, contentEl.nextSibling);
        }
    }

    function renderFooter(post: FediversePost, vis: typeof visibility, time: string, date: string) {
        const bottomSection = document.getElementById(DOM_ELEMENT_IDS.BOTTOM_SECTION) as HTMLDivElement;
        const timestampEl = document.getElementById(DOM_ELEMENT_IDS.TIMESTAMP) as HTMLDivElement;
        const statsEl = document.getElementById(DOM_ELEMENT_IDS.STATS) as HTMLDivElement;

        if (timestampEl) {
            timestampEl.textContent = `${time} · ${date}`;
            timestampEl.classList.add('toggle-transition');
            if (vis.timestamp) {
                timestampEl.classList.remove('toggle-collapsed', 'hidden');
                timestampEl.classList.add('toggle-expanded');
            } else {
                timestampEl.classList.remove('toggle-expanded');
                timestampEl.classList.add('toggle-collapsed');
            }
        }

        if (statsEl) {
            statsEl.classList.add('toggle-transition');
            if (vis.stats) {
                statsEl.classList.remove('toggle-collapsed', 'hidden');
                statsEl.classList.add('toggle-expanded');
            } else {
                statsEl.classList.remove('toggle-expanded');
                statsEl.classList.add('toggle-collapsed');
            }
        }

        (document.getElementById(DOM_ELEMENT_IDS.REPLIES) as HTMLSpanElement).textContent = post.repliesCount.toString();
        (document.getElementById(DOM_ELEMENT_IDS.BOOSTS) as HTMLSpanElement).textContent = post.boostsCount.toString();
        (document.getElementById(DOM_ELEMENT_IDS.FAVS) as HTMLSpanElement).textContent = post.favouritesCount.toString();

        const showBottom = vis.timestamp || vis.stats;
        if (bottomSection) {
            bottomSection.classList.add('toggle-transition');
            if (showBottom) {
                bottomSection.classList.remove('toggle-collapsed', 'hidden');
                bottomSection.classList.add('toggle-expanded');
            } else {
                bottomSection.classList.remove('toggle-expanded');
                bottomSection.classList.add('toggle-collapsed');
            }
        }
    }
    function setPreviewState(state: 'loading' | 'content' | 'error') {
        if (state === 'loading') {
            if (previewStatus) previewStatus.textContent = 'Loading...';
            if (styleAContainer) {
                styleAContainer.classList.remove('hidden');
                styleAContainer.classList.add('flex', 'flex-col');
            }
            if (loader) {
                loader.classList.remove('hidden');
                loader.classList.add('flex');
            }
        } else if (state === 'content') {
            if (loader) {
                loader.classList.add('hidden');
                loader.classList.remove('flex');
            }
            if (styleAContainer) {
                styleAContainer.classList.remove('hidden');
                styleAContainer.classList.add('flex', 'flex-col');
            }
        } else if (state === 'error') {
            if (previewStatus) {
                previewStatus.textContent = 'Error loading preview';
                previewStatus.className = 'text-sm text-red-600';
            }
            if (loader) {
                loader.classList.add('hidden');
                loader.classList.remove('flex');
            }
            if (styleAContainer) styleAContainer.classList.add('hidden');
        }
    }
    function setGenerateButtonState(isLoading: boolean) { if(generateBtn) { generateBtn.disabled = isLoading; generateBtn.textContent = isLoading ? 'Fetching...' : 'Generate Preview'; } }
    let errorHideTimeout: ReturnType<typeof setTimeout> | null = null;

    function showError(message: string, detail?: string) {
        const fullMessage = detail ? `${message}\n${detail}` : message;

        // Clear any existing timeout
        if (errorHideTimeout) {
            clearTimeout(errorHideTimeout);
            errorHideTimeout = null;
        }

        if(errorMessage) {
            errorMessage.textContent = fullMessage;
            // Show the error message with transition
            errorMessage.classList.remove('opacity-0', 'max-h-0');
            errorMessage.classList.add('opacity-100', 'max-h-32');
        }

        if(previewArea) {
            previewArea.classList.add('hidden');
            previewArea.classList.remove('flex', 'flex-col');
        }
        if(downloadBtn) downloadBtn.disabled = true;
        if(copyBtn) copyBtn.disabled = true;
        setPreviewState('error');

        // Auto-hide after 5 seconds
        errorHideTimeout = setTimeout(() => {
            hideError();
        }, 5000);
    }

    function hideError() {
        if(errorMessage) {
            errorMessage.classList.remove('opacity-100', 'max-h-32');
            errorMessage.classList.add('opacity-0', 'max-h-0');
            // Clear text after transition completes
            setTimeout(() => {
                if(errorMessage.classList.contains('opacity-0')) {
                    errorMessage.textContent = '';
                }
            }, 500);
        }
    }

    function toggleClearButtonVisibility() {
        if (urlInput && clearUrlBtn) {
            if (urlInput.value.trim().length > 0) {
                // Show button: remove hidden, add flex, increase input padding
                clearUrlBtn.classList.remove('hidden');
                clearUrlBtn.classList.add('flex');
                urlInput.classList.remove('pr-4');
                urlInput.classList.add('pr-12');
            } else {
                // Hide button: add hidden, remove flex, decrease input padding
                clearUrlBtn.classList.remove('flex');
                clearUrlBtn.classList.add('hidden');
                urlInput.classList.remove('pr-12');
                urlInput.classList.add('pr-4');
            }
        }
    }
    function clearUrlInput() {
        if (urlInput) {
            urlInput.value = '';
            toggleClearButtonVisibility();
            urlInput.focus();
        }
    }
    function toggleAccordion(content: HTMLElement | null, icon: SVGElement | null, button: HTMLElement | null) {
        if (content && icon && button) {
            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', String(!isExpanded));
            icon.classList.toggle('rotate-180');

            if (isExpanded) {
                // Collapse
                content.style.maxHeight = content.scrollHeight + 'px'; // Set to current height before collapsing
                requestAnimationFrame(() => {
                    content.style.maxHeight = '0';
                    content.style.opacity = '0';
                    content.style.transform = 'scaleY(0)';
                });
                content.addEventListener('transitionend', function handler() {
                    content.classList.add('hidden');
                    content.removeEventListener('transitionend', handler);
                }, { once: true });
            } else {
                // Expand
                content.classList.remove('hidden');
                content.style.maxHeight = '0';
                content.style.opacity = '0';
                content.style.transform = 'scaleY(0)';
                requestAnimationFrame(() => {
                    content.style.maxHeight = content.scrollHeight + 'px';
                    content.style.opacity = '1';
                    content.style.transform = 'scaleY(1)';
                });
                content.addEventListener('transitionend', function handler() {
                    content.style.maxHeight = '500px'; // Allow content to grow beyond initial scrollHeight if needed
                    content.removeEventListener('transitionend', handler);
                }, { once: true });
            }
        }
    }
});
