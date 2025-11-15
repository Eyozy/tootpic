import { templateManager } from './templateManager';
import { imageGenerator } from './imageGenerator';
import { domCache } from './domCache';
import { DOM_ELEMENT_IDS } from '../constants';
import { FediverseClient } from './fediverseClient';
import type { FediversePost, FediverseAttachment, FediversePoll } from '../types/activitypub';

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

document.addEventListener('DOMContentLoaded', () => {
    const urlInput = domCache.getElement(DOM_ELEMENT_IDS.MASTODON_URL) as HTMLInputElement;
    const generateBtn = domCache.getElement(DOM_ELEMENT_IDS.GENERATE_BTN) as HTMLButtonElement;
    const downloadBtn = domCache.getElement(DOM_ELEMENT_IDS.DOWNLOAD_BTN) as HTMLButtonElement;
    const errorMessage = domCache.getElement(DOM_ELEMENT_IDS.ERROR_MESSAGE) as HTMLDivElement;
    const previewArea = domCache.getElement(DOM_ELEMENT_IDS.PREVIEW_AREA) as HTMLDivElement;
    const loader = domCache.getElement(DOM_ELEMENT_IDS.LOADER) as HTMLDivElement;
    const styleAContainer = domCache.getElement(DOM_ELEMENT_IDS.STYLE_A_CONTAINER) as HTMLDivElement;
    const clearUrlBtn = domCache.getElement(DOM_ELEMENT_IDS.CLEAR_URL_BTN) as HTMLButtonElement;
    const visibilityCheckboxes = document.querySelectorAll<HTMLInputElement>('input[name="visibility"]');
    const templateToggle = domCache.getElement(DOM_ELEMENT_IDS.TEMPLATE_TOGGLE) as HTMLButtonElement;
    const optionsToggle = domCache.getElement(DOM_ELEMENT_IDS.OPTIONS_TOGGLE) as HTMLButtonElement;
    const optionsContent = domCache.getElement(DOM_ELEMENT_IDS.OPTIONS_CONTENT) as HTMLDivElement;
    const optionsIcon = domCache.getElement(DOM_ELEMENT_IDS.OPTIONS_ICON) as SVGElement;
    const previewStatus = domCache.getElement(DOM_ELEMENT_IDS.PREVIEW_STATUS) as HTMLSpanElement;
    const contentWarningBanner = domCache.getElement(DOM_ELEMENT_IDS.CONTENT_WARNING_BANNER) as HTMLDivElement;
    const contentWarningText = domCache.getElement(DOM_ELEMENT_IDS.CONTENT_WARNING_TEXT) as HTMLSpanElement;
    const contentWarningToggle = domCache.getElement(DOM_ELEMENT_IDS.CONTENT_WARNING_TOGGLE) as HTMLInputElement;
    const contentWarningToggleContainer = domCache.getElement(DOM_ELEMENT_IDS.CONTENT_WARNING_TOGGLE_CONTAINER) as HTMLDivElement;

    let postData: FediversePost | null = null;
    let fetchedInstance = '';
    let imageMap: Record<string, string> = {};
    let visibility = { stats: true, timestamp: true, instance: true, contentWarning: true };
    let eventSource: EventSource | null = null;
    let loadedImageUrls = new Set<string>();
    let failedImageUrls = new Set<string>();
    let isRendering = false;
    let pendingRender = false;

    // Content warning animation state management
    let contentWarningAnimationState = {
        isAnimating: false,
        lastContent: '',
        debounceTimer: null as ReturnType<typeof setTimeout> | null,
        isContentLoading: false
    };

    generateBtn?.addEventListener('click', fetchFediversePost);
    urlInput?.addEventListener('input', toggleClearButtonVisibility);
    clearUrlBtn?.addEventListener('click', clearUrlInput);
    downloadBtn?.addEventListener('click', () => imageGenerator.generateAndDownload().catch(err => showError('Image generation failed.')));
    templateToggle?.addEventListener('click', () => templateManager.openModal());
    optionsToggle?.addEventListener('click', () => toggleAccordion(optionsContent, optionsIcon, optionsToggle));

    
    document.addEventListener('templateSelected', () => {
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
        if (eventSource) eventSource.close();

        // Reset image tracking state
        loadedImageUrls.clear();
        failedImageUrls.clear();

        const url = urlInput?.value?.trim() || '';

        if (!url) {
            return showError('Please enter a URL');
        }

        if (previewArea) previewArea.classList.remove('hidden');
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

            // If we already have image URLs from the server, use them
            let imageUrls: string[] = [];
            if (responseData.imageUrls && responseData.imageUrls.length > 0) {
                imageUrls = responseData.imageUrls;
            } else if (postData) {
                // Otherwise collect image URLs from the post data
                imageUrls = [
                    ...postData.attachments.map(att => att.url),
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

            // Don't render preview yet, wait for all images to load first
            if (imageUrls.length === 0) {
                renderPreview();
                if(downloadBtn) downloadBtn.disabled = false;
                setGenerateButtonState(false);
                return;
            }

            // Show loading state while waiting for images
            setPreviewState('loading');
            if (previewStatus) {
                previewStatus.textContent = `Loading images (0/${imageUrls.length})...`;
            }
            if (downloadBtn) downloadBtn.disabled = true;

            if (imageUrls.length === 0) {
                if (previewStatus) {
                    previewStatus.textContent = 'Preview loaded successfully';
                    previewStatus.className = 'text-sm text-green-600';
                }
                if(downloadBtn) downloadBtn.disabled = false;
                setGenerateButtonState(false);
                return;
            }

            if (previewStatus) {
                previewStatus.textContent = `Loading images (0/${imageUrls.length})...`;
            }

            const encodedUrls = encodeURIComponent(imageUrls.join(','));
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

                // Reset render state before final render
                isRendering = false;
                pendingRender = false;

                // Now render everything at once with all images loaded
                renderPreview();

                if (previewStatus && previewStatus.textContent?.includes('Loading')) {
                    previewStatus.textContent = 'Preview loaded successfully';
                    previewStatus.className = 'text-sm text-green-600';
                }
                if(downloadBtn) downloadBtn.disabled = false;
                setGenerateButtonState(false);
            };

            eventSource.onerror = (err) => {
                console.error("EventSource failed:", err);
                // Don't immediately call handleStreamEnd, let it retry naturally
                // Only clean up after multiple consecutive failures
                if (!eventSource) return; // Already cleaned up

                try {
                    eventSource.close();
                    eventSource.onopen = null;
                    eventSource.onmessage = null;
                    eventSource.onerror = null;
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
        if (!postData || !styleAContainer) return;

        // Prevent concurrent rendering
        if (isRendering) {
            pendingRender = true;
            return;
        }

        isRendering = true;
        pendingRender = false;

        // Use the current post's data (no reblog handling for now as most platforms handle this differently)
        const sourcePost: FediversePost = postData;

        // --- 1. Handle Content Warning ---
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

    /**
     * Update content warning banner with optimized animations using CSS classes
     */
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

        // --- 2. Process Content and Emojis ---
        // Sanitize and prepare the main post content.
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

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentHTML;

        // Keep links in their original format for natural appearance
        tempDiv.querySelectorAll('a:not(.mention):not(.hashtag)').forEach(link => {
            // Ensure links have proper styling but keep original format
            link.classList.add('text-blue-600', 'hover:text-blue-800', 'underline');
        });

        // Style hashtags in content to make them more visible
        tempDiv.querySelectorAll('a.hashtag').forEach(hashtag => {
            hashtag.classList.add('inline-block', 'text-blue-600', 'hover:text-blue-800', 'font-medium');
        });

        contentHTML = tempDiv.innerHTML;

        const allEmojis = sourcePost.account.emojis || [];

        /**
         * Optimized emoji replacement using single regex
         */
        function replaceEmojis(content: string, emojis: typeof allEmojis): string {
            const emojiMap = new Map<string, string>();

            emojis.forEach(emoji => {
                const dataUrl = imageMap[emoji.url];
                let imgTag: string;

                if (dataUrl && dataUrl !== 'failed') {
                    imgTag = `<img src="${dataUrl}" alt=":${emoji.shortcode}:" class="custom-emoji inline-block w-5 h-5 align-text-bottom">`;
                } else if (imageMap[emoji.url] === undefined) {
                    imgTag = `<img src="${emoji.url}" alt=":${emoji.shortcode}:" class="custom-emoji inline-block w-5 h-5 align-text-bottom" onerror="this.onerror=null; this.outerHTML=':${emoji.shortcode}:'">`;
                } else {
                    imgTag = `:${emoji.shortcode}:`;
                }

                emojiMap.set(emoji.shortcode.toLowerCase(), imgTag);
            });

            return content.replace(/:([a-zA-Z0-9_]+):/g, (match, shortcode) => {
                return emojiMap.get(shortcode.toLowerCase()) || match;
            });
        }

        contentHTML = replaceEmojis(contentHTML, allEmojis);

        let displayNameHTML = sourcePost.account.displayName;
        displayNameHTML = replaceEmojis(displayNameHTML, sourcePost.account.emojis || []);

        

        // --- 2.5 Process Tags ---
        // Tags are already in the content HTML with proper styling

        // --- 2. Render User and Content Information ---
        // Render the user's avatar, display name, and username FIRST (before content)
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
        const avatarContainerEl = domCache.getElement(DOM_ELEMENT_IDS.AVATAR_CONTAINER) as HTMLDivElement;
        const displayNameEl = domCache.getElement(DOM_ELEMENT_IDS.DISPLAY_NAME) as HTMLDivElement;
        const usernameEl = domCache.getElement(DOM_ELEMENT_IDS.USERNAME) as HTMLDivElement;

        avatarContainerEl.innerHTML = avatarHTML;
        displayNameEl.innerHTML = displayNameHTML;

        // Construct the username, optionally including the instance name based on visibility settings.
        const { acct } = sourcePost.account;
        const usernamePart = acct.includes('@') ? acct.split('@')[0] : acct;
        const instancePart = acct.includes('@') ? acct.split('@').slice(1).join('@') : fetchedInstance;
        usernameEl.textContent = visibility.instance && instancePart ? `@${usernamePart}@${instancePart}` : `@${usernamePart}`;

    
        // Inject the processed content into the DOM AFTER user info is rendered
        (domCache.getElement(DOM_ELEMENT_IDS.CONTENT) as HTMLDivElement).innerHTML = contentHTML;

        // --- 3. Render Media and Footer ---
        // Render media attachments like images and videos.
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

        // --- 4. Finalize UI State ---
        // Show the populated preview card.
        setPreviewState('content');

        // Reset render lock and check for pending render
        isRendering = false;
        if (pendingRender) {
            // Use setTimeout to avoid call stack issues
            setTimeout(() => renderPreview(), 0);
        }
    }
    
    /**
     * Renders media attachments (images/videos) into the preview card.
     * @param attachments - The list of media attachments from the post.
     * @param imgMap - A map of image URLs to their Base64 data URLs.
     */
    function renderMedia(attachments: FediverseAttachment[], imgMap: Record<string, string>) {
        const container = domCache.getElement(DOM_ELEMENT_IDS.ATTACHMENT) as HTMLDivElement;
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

        // Only apply 3/2 aspect ratio for image-only layouts
        if (toDisplay.length >= 2 && !hasVideosOrGifs) {
            container.style.aspectRatio = '3 / 2';
        }
        container.style.gridTemplateColumns = toDisplay.length > 1 ? '1fr 1fr' : '1fr';

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

            // Special handling for videos without preview URL
            if ((att.type === 'video' || att.type === 'gifv') && !previewUrl) {
                

                // Create a visually appealing placeholder for videos
                // Extract a simple identifier from the URL for display
                const urlParts = url.split('/');
                const filename = urlParts[urlParts.length - 1].split('.')[0];
                const shortId = filename.substring(0, 8) + '...';

                wrapper.innerHTML = `
                    <div class="w-full h-full bg-gradient-to-br from-gray-800 to-gray-900 flex flex-col items-center justify-center text-white p-4">
                        <svg class="w-20 h-20 mb-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z"/>
                        </svg>
                        <div class="text-base font-medium mb-1">${att.type === 'gifv' ? 'GIF Video' : 'Video Content'}</div>
                        <div class="text-xs text-gray-400 font-mono">${shortId}</div>
                    </div>
                `;
            }
            else if (dataUrl && dataUrl !== 'failed') {
                // Image is loaded, display it
                wrapper.innerHTML = `<img alt="${att.description || `Attachment ${index + 1}`}" class="w-full h-full object-cover" src="${dataUrl}">`;
            } else if (dataUrl === 'failed') {
                // If image loading failed, try to use the original URL as fallback
                wrapper.innerHTML = `<img alt="${att.description || `Attachment ${index + 1}`}" class="w-full h-full object-cover" src="${displayUrl}" onerror="this.parentElement.innerHTML = '<div class=\"w-full h-full bg-gray-200 flex items-center justify-center text-gray-500\"><svg class=\"w-8 h-8 text-gray-400\" fill=\"none\" stroke=\"currentColor\" viewBox=\"0 0 24 24\"><path stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z\"></path></svg></div>'">`;
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
            optionText.textContent = option.title;

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
        const contentEl = domCache.getElement(DOM_ELEMENT_IDS.CONTENT) as HTMLDivElement;
        if (contentEl.parentNode) {
            contentEl.parentNode.insertBefore(pollContainer, contentEl.nextSibling);
        }
    }

    // --- Helper functions ---
    function renderFooter(post: FediversePost, vis: typeof visibility, time: string, date: string) {
        const bottomSection = domCache.getElement(DOM_ELEMENT_IDS.BOTTOM_SECTION) as HTMLDivElement;
        const timestampEl = domCache.getElement(DOM_ELEMENT_IDS.TIMESTAMP) as HTMLDivElement;
        const statsEl = domCache.getElement(DOM_ELEMENT_IDS.STATS) as HTMLDivElement;

        if (timestampEl) {
            timestampEl.textContent = `${time} · ${date}`;
            timestampEl.style.display = vis.timestamp ? 'block' : 'none';
        }

        if (statsEl) {
            statsEl.style.display = vis.stats ? 'flex' : 'none';
        }

        (domCache.getElement(DOM_ELEMENT_IDS.REPLIES) as HTMLSpanElement).textContent = post.repliesCount.toString();
        (domCache.getElement(DOM_ELEMENT_IDS.BOOSTS) as HTMLSpanElement).textContent = post.boostsCount.toString();
        (domCache.getElement(DOM_ELEMENT_IDS.FAVS) as HTMLSpanElement).textContent = post.favouritesCount.toString();

        const showBottom = vis.timestamp || vis.stats;
        if (bottomSection) {
            bottomSection.style.display = showBottom ? 'block' : 'none';
            bottomSection.style.borderTopWidth = showBottom ? '1px' : '0';
            bottomSection.style.paddingTop = showBottom ? '1rem' : '0';
        }
    }
    function setPreviewState(state: 'loading' | 'content' | 'error') { if(loader) loader.classList.add('hidden'); if(styleAContainer) styleAContainer.classList.add('hidden'); if(state === 'loading' && loader) { loader.classList.remove('hidden'); if(previewStatus) previewStatus.textContent = 'Loading...'; } else if(state === 'content' && styleAContainer) { styleAContainer.classList.remove('hidden'); } else if (state === 'error' && previewStatus) { if(previewStatus) previewStatus.textContent = 'Error loading preview'; if(previewStatus) previewStatus.className = 'text-sm text-red-600'; } }
    function setGenerateButtonState(isLoading: boolean) { if(generateBtn) { generateBtn.disabled = isLoading; generateBtn.textContent = isLoading ? 'Fetching...' : 'Generate Preview'; } }
    function showError(message: string, detail?: string) {
        const fullMessage = detail ? `${message}\n${detail}` : message;
        if(errorMessage) errorMessage.textContent = fullMessage;
        if(previewArea) previewArea.classList.add('hidden');
        if(downloadBtn) downloadBtn.disabled = true;
        setPreviewState('error');
    }

    function toggleClearButtonVisibility() { if (urlInput && clearUrlBtn) { urlInput.value.trim().length > 0 ? clearUrlBtn.classList.remove('hidden') : clearUrlBtn.classList.add('hidden'); } }
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
