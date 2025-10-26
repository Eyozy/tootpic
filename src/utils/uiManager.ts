import { templateManager } from './templateManager';
import { imageGenerator } from './imageGenerator';
import { domCache } from './domCache';
import { resourceLoader } from './resourceLoader';
import { TEMPLATE_NAMES, DOM_ELEMENT_IDS, API_CONFIG } from '../constants';
import type { MastodonStatus, MastodonMediaAttachment } from '../types/mastodon';

declare var htmlToImage: any;

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
    const useOriginalPostDataCheckbox = domCache.getElement(DOM_ELEMENT_IDS.USE_ORIGINAL_POST_DATA) as HTMLInputElement;
    const instanceToggleContainer = domCache.getElement(DOM_ELEMENT_IDS.INSTANCE_TOGGLE_CONTAINER) as HTMLDivElement;

    const templateToggle = domCache.getElement(DOM_ELEMENT_IDS.TEMPLATE_TOGGLE) as HTMLButtonElement;

    const optionsToggle = domCache.getElement(DOM_ELEMENT_IDS.OPTIONS_TOGGLE) as HTMLButtonElement;
    const optionsContent = domCache.getElement(DOM_ELEMENT_IDS.OPTIONS_CONTENT) as HTMLDivElement;
    const optionsIcon = domCache.getElement(DOM_ELEMENT_IDS.OPTIONS_ICON) as SVGElement;
    const previewStatus = domCache.getElement(DOM_ELEMENT_IDS.PREVIEW_STATUS) as HTMLSpanElement;

    let postData: MastodonStatus | null = null;
    let fetchedInstance = '';
    let visibility = {
        stats: true,
        timestamp: true,
        instance: true,
    };

    const postCache = new Map();

    let currentLoadController: AbortController | null = null;

    generateBtn?.addEventListener('click', fetchMastodonPost);

    urlInput?.addEventListener('input', toggleClearButtonVisibility);
    urlInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && currentLoadController) {
            cancelCurrentLoad();
        }
    });
    clearUrlBtn?.addEventListener('click', clearUrlInput);

    function cancelCurrentLoad() {
        if (currentLoadController) {
            currentLoadController.abort();
            currentLoadController = null;

            if (generateBtn) {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Generate Preview';
            }

            if (previewStatus) {
                previewStatus.textContent = 'Loading cancelled';
                previewStatus.className = 'text-sm text-gray-600';
            }

            resourceLoader.clearCache();
        }
    }
            downloadBtn?.addEventListener('click', async () => {
                try {
                    const qualitySelector = domCache.getElement(DOM_ELEMENT_IDS.QUALITY_SELECTOR) as HTMLSelectElement;
                    const pixelRatio = qualitySelector ? parseFloat(qualitySelector.value) : API_CONFIG.IMAGE_PIXEL_RATIO;
                    await imageGenerator.generateAndDownload({ pixelRatio });
                } catch (error) {
                    console.error('Download failed:', error);
                    showError('Image generation failed. Please try again.');
                }
            });
    templateToggle?.addEventListener('click', () => {
        templateManager.openModal();
    });

    optionsToggle?.addEventListener('click', () => {
        toggleAccordion(optionsContent, optionsIcon, optionsToggle);
    });

    document.addEventListener('templateSelected', (e: any) => {
        if (postData) {
            updatePreview();
        }
    });

    try {
        templateManager.switchTemplate(templateManager.getCurrentTemplate());
    } catch (error) {
        console.error('Error initializing template manager:', error);
    }

    const allCheckboxes = [...visibilityCheckboxes, useOriginalPostDataCheckbox].filter(cb => cb !== null) as HTMLInputElement[];
    allCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            visibilityCheckboxes.forEach(cb => {
                if (cb && cb.value) {
                    visibility[cb.value as keyof typeof visibility] = cb.checked;
                }
            });
            if (postData) {
                updatePreview();
            }
        });
    });

    function toggleAccordion(content: HTMLElement | null, icon: SVGElement | null, button: HTMLElement | null) {
        if (content && icon && button) {
            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', (!isExpanded).toString());
            icon.classList.toggle('rotate-180');
            content.classList.toggle('hidden');
        }
    }

    function setPreviewState(state: 'loading' | 'content' | 'error') {
        if (loader) loader.classList.add('hidden');
        if (styleAContainer) styleAContainer.classList.add('hidden');

        if (state === 'loading' && loader) {
            loader.classList.remove('hidden');
            if (previewStatus) previewStatus.textContent = 'Loading...';
        } else if (state === 'content' && styleAContainer) {
            styleAContainer.classList.remove('hidden');
            if (previewStatus) previewStatus.textContent = 'Preview loaded successfully';
            if (previewStatus) previewStatus.className = 'text-sm text-green-600';
        } else if (state === 'error' && previewStatus) {
            if (previewStatus) previewStatus.textContent = 'Error loading preview';
            if (previewStatus) previewStatus.className = 'text-sm text-red-600';
        }
    }

    function setGenerateButtonState(isLoading: boolean) {
        if (isLoading && generateBtn) {
            if (errorMessage) errorMessage.textContent = '';
            generateBtn.disabled = true;
            generateBtn.textContent = 'Fetching...';
        } else if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Generate Preview';
        }
    }

    function showError(message: string) {
        if (errorMessage) errorMessage.textContent = message;
        if (previewArea) previewArea.classList.add('hidden');
        if (downloadBtn) downloadBtn.disabled = true;
        setPreviewState('error');
    }

    async function fetchMastodonPost() {
        if (!urlInput) return;
        const url = urlInput.value.trim();
        if (!url) {
            showError('Please enter a URL.');
            return;
        }

        let match;
        try {
            const urlObject = new URL(url);
            const pathParts = urlObject.pathname.split('/').filter(p => p);
            if (pathParts.length >= 2 && pathParts[0].startsWith('@')) {
                match = { instance: urlObject.hostname, id: pathParts[1] };
            } else {
                showError('Invalid URL format. Expected format: https://instance/@user/id');
                return;
            }
        } catch(e) {
            showError('Invalid URL format.');
            return;
        }

        if (!match) {
            showError('Could not parse instance and post ID from URL.');
            return;
        }

        const { instance, id } = match;
        fetchedInstance = instance;
        const apiUrl = `https://cors.eu.org/https://${instance}/api/v1/statuses/${id}`;

        if (postCache.has(apiUrl)) {
            postData = postCache.get(apiUrl);
            updatePreview();
            return;
        }


        if (previewArea) previewArea.classList.remove('hidden');
        setGenerateButtonState(true);
        setPreviewState('loading');

        if (previewStatus) {
            previewStatus.textContent = 'Loading... (Press ESC to cancel)';
            previewStatus.className = 'text-sm text-blue-600';
        }

        try {
            const response = await fetch(apiUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            if (!response.ok) {
                if (response.status === 404) throw new Error('Post not found. Please check if the URL is correct and the post is public.');
                throw new Error(`Network error: ${response.statusText}`);
            }
            postData = await response.json();
            postCache.set(apiUrl, postData);

            const imageResources = resourceLoader.extractImageResources(postData);

            if (imageResources.length > 0) {
                if (previewStatus) {
                    previewStatus.textContent = 'Loading images...';
                    previewStatus.className = 'text-sm text-blue-600';
                }

                try {
                    await resourceLoader.preloadImages(imageResources, {
                        timeout: 8000,
                        retryAttempts: 2,
                        retryDelay: 1000,
                        onProgress: (progress) => {
                            const statusText = `Loading images: ${progress.loaded}/${progress.total} (${progress.percentage}%)`;
                            if (previewStatus) previewStatus.textContent = statusText;
                        },
                        onResourceLoaded: (resource) => {
                            console.log(`Loaded ${resource.type}: ${resource.url}`);
                        },
                        onResourceFailed: (resource, error) => {
                            console.warn(`Failed to load ${resource.type}: ${resource.url}`, error);
                        }
                    });

                    const cacheStats = resourceLoader.getCacheStats();
                    const successRate = Math.round((cacheStats.size / imageResources.length) * 100);

                    if (successRate < 50) {
                        console.warn(`Low image loading success rate: ${successRate}%`);
                    }

                } catch (preloadError) {
                    console.error('Image preloading failed:', preloadError);
                    if (previewStatus) {
                        previewStatus.textContent = 'Some images failed to load, continuing...';
                        previewStatus.className = 'text-sm text-yellow-600';
                    }
                }
            } else {
                if (previewStatus) {
                    previewStatus.textContent = 'Processing content...';
                    previewStatus.className = 'text-sm text-blue-600';
                }
            }

            updatePreview();

            if (downloadBtn) downloadBtn.disabled = false;

        } catch (error) {
            showError(error instanceof Error ? error.message : 'An unknown error occurred');
            postData = null;
        } finally {
            setGenerateButtonState(false);
        }
    }

    function toggleClearButtonVisibility() {
        if (urlInput && clearUrlBtn) {
            if (urlInput.value.trim().length > 0) {
                clearUrlBtn.classList.remove('hidden');
            } else {
                clearUrlBtn.classList.add('hidden');
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

    function updatePreview() {
        if (!postData || !useOriginalPostDataCheckbox || !styleAContainer) return;

        const useOriginal = useOriginalPostDataCheckbox.checked;
        const sourcePost: MastodonStatus = useOriginal && postData.reblog ? postData.reblog : postData;

        if (styleAContainer.classList.contains('hidden')) {
            styleAContainer.classList.remove('hidden');
        }

        const corsProxy = 'https://cors.eu.org/';

        const fragment = document.createDocumentFragment();

        let content = sourcePost.content;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = content;
        const links = tempDiv.querySelectorAll('a');
        links.forEach(link => {
            if (!link.classList.contains('mention') && !link.classList.contains('hashtag')) {
                link.classList.add('url');
            }
        });
        content = tempDiv.innerHTML;

        if (sourcePost.emojis) {
            sourcePost.emojis.forEach(emoji => {
                const regex = new RegExp(`:${emoji.shortcode}:`, 'g');
                const proxiedUrl = `${corsProxy}${emoji.url}`;

                if (resourceLoader.isImageCached(emoji.url)) {
                    content = content.replace(regex, `<img src="${proxiedUrl}" alt=":${emoji.shortcode}:" class="custom-emoji" crossorigin="anonymous">`);
                } else {
                    content = content.replace(regex, `:${emoji.shortcode}:`);
                }
            });
        }

        const date = new Date(sourcePost.created_at);
        const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const formattedTime = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

        const updates: Array<() => void> = [];

        const avatarContainer = document.getElementById(DOM_ELEMENT_IDS.AVATAR_CONTAINER) as HTMLDivElement | null;
        if (avatarContainer) {
            avatarContainer.innerHTML = ''; // Clear previous avatar
            const avatarEl = document.createElement('img');
            avatarEl.id = 'style-a-avatar';
            avatarEl.alt = 'Mastodon user avatar';
            avatarEl.className = 'w-12 h-12 rounded-lg';
            avatarEl.loading = 'lazy';
            avatarEl.decoding = 'async';
            avatarEl.crossOrigin = 'anonymous';

            if (resourceLoader.isImageCached(sourcePost.account.avatar)) {
                avatarEl.src = `${corsProxy}${sourcePost.account.avatar}`;
            } else {
                avatarEl.src = '/favicon.svg';
            }
            avatarContainer.appendChild(avatarEl);
        }

        const displayNameEl = document.getElementById(DOM_ELEMENT_IDS.DISPLAY_NAME) as HTMLDivElement | null;
        if (displayNameEl) {
            let displayName = sourcePost.account.display_name;
            if (sourcePost.account.emojis) {
                sourcePost.account.emojis.forEach(emoji => {
                    const regex = new RegExp(`:${emoji.shortcode}:`, 'g');
                    const proxiedUrl = `${corsProxy}${emoji.url}`;

                    if (resourceLoader.isImageCached(emoji.url)) {
                        displayName = displayName.replace(regex, `<img src="${proxiedUrl}" alt=":${emoji.shortcode}:" class="custom-emoji" crossorigin="anonymous">`);
                    } else {
                        displayName = displayName.replace(regex, `:${emoji.shortcode}:`);
                    }
                });
            }
            updates.push(() => {
                displayNameEl.innerHTML = displayName;
            });
        }

        const usernameEl = document.getElementById(DOM_ELEMENT_IDS.USERNAME) as HTMLDivElement | null;
        if (usernameEl) {
            let fullAcct = sourcePost.account.acct;
            let usernamePart = fullAcct.includes('@') ? fullAcct.split('@')[0] : fullAcct;
            let instancePart = fullAcct.includes('@') ? fullAcct.split('@').slice(1).join('@') : fetchedInstance;
            let displayUsername = `@${usernamePart}`;
            if (visibility.instance && instancePart) {
                displayUsername += `@${instancePart}`;
            }
            updates.push(() => {
                usernameEl.textContent = displayUsername;
                usernameEl.style.display = 'block';
            });
        }

        const contentEl = document.getElementById(DOM_ELEMENT_IDS.CONTENT) as HTMLDivElement | null;
        if (contentEl) {
            updates.push(() => {
                contentEl.innerHTML = content;
            });
        }

        updates.forEach(update => update());

        updateMediaAttachments(sourcePost.media_attachments);

        updateFooterSection(sourcePost, visibility, formattedTime, formattedDate);

        setPreviewState('content');
    }

    function updateMediaAttachments(mediaAttachments: MastodonMediaAttachment[]) {
        const attachmentContainer = document.getElementById(DOM_ELEMENT_IDS.ATTACHMENT) as HTMLDivElement | null;
        if (!attachmentContainer) return;

        attachmentContainer.innerHTML = '';
        attachmentContainer.className = 'mt-3 rounded-lg overflow-hidden border bg-gray-100';

        if (mediaAttachments.length > 0) {
            attachmentContainer.style.display = 'grid';
            attachmentContainer.classList.add('gap-px');

            const attachmentsToDisplay = mediaAttachments.slice(0, 4);

            switch (attachmentsToDisplay.length) {
                case 1:
                    attachmentContainer.style.gridTemplateColumns = '1fr';
                    break;
                case 2:
                    attachmentContainer.style.gridTemplateColumns = '1fr 1fr';
                    break;
                case 3:
                    attachmentContainer.style.gridTemplateColumns = '1fr 1fr';
                    break;
                case 4:
                    attachmentContainer.style.gridTemplateColumns = '1fr 1fr';
                    break;
            }

            const corsProxy = 'https://cors.eu.org/';

            const fragment = document.createDocumentFragment();

            attachmentsToDisplay.forEach((attachment: MastodonMediaAttachment, index: number) => {
                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'overflow-hidden relative';

                let imageUrl: string;
                if (attachment.type === 'image') {
                    imageUrl = attachment.url;
                } else {
                    imageUrl = attachment.preview_url || attachment.url;
                }

                const isImagePreloaded = resourceLoader.isImageCached(imageUrl);

                if (isImagePreloaded) {
                    const img = document.createElement('img');
                    img.crossOrigin = 'anonymous';
                    img.alt = attachment.description || `Post attachment ${index + 1}`;
                    img.className = 'w-full h-full object-cover';
                    img.src = `${corsProxy}${imageUrl}`;
                    imgWrapper.appendChild(img);
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'w-full h-full bg-gray-200 flex items-center justify-center text-gray-500';
                    placeholder.innerHTML = `
                        <div class="text-center">
                            <svg class="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                            </svg>
                            <p class="text-xs">Image not available</p>
                        </div>
                    `;
                    imgWrapper.appendChild(placeholder);
                }

                if (attachment.type === 'gifv') {
                    const gifIndicator = document.createElement('div');
                    gifIndicator.className = 'absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded';
                    gifIndicator.textContent = 'GIF';
                    imgWrapper.appendChild(gifIndicator);
                } else if (attachment.type === 'video') {
                    const videoIndicator = document.createElement('div');
                    videoIndicator.className = 'absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded flex items-center';
                    videoIndicator.innerHTML = `
                        <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v8a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z"/>
                        </svg>
                        Video
                    `;
                    imgWrapper.appendChild(videoIndicator);
                }

                if (attachmentsToDisplay.length === 3 && index === 0) {
                    imgWrapper.style.gridRow = 'span 2 / span 2';
                }

                fragment.appendChild(imgWrapper);
            });

            attachmentContainer.appendChild(fragment);
        } else {
            attachmentContainer.style.display = 'none';
        }
    }

    function updateFooterSection(sourcePost: MastodonStatus, visibility: any, formattedTime: string, formattedDate: string) {
        const bottomSection = document.getElementById(DOM_ELEMENT_IDS.BOTTOM_SECTION) as HTMLDivElement | null;
        const timestampEl = document.getElementById(DOM_ELEMENT_IDS.TIMESTAMP) as HTMLDivElement | null;
        const statsEl = document.getElementById(DOM_ELEMENT_IDS.STATS) as HTMLDivElement | null;
    
        if (timestampEl) {
            timestampEl.textContent = `${formattedTime} · ${formattedDate}`;
            timestampEl.style.display = visibility.timestamp ? 'block' : 'none';
            timestampEl.style.marginBottom = (visibility.timestamp && visibility.stats) ? '0.75rem' : '0';
        }
    
        const repliesEl = document.getElementById(DOM_ELEMENT_IDS.REPLIES) as HTMLSpanElement | null;
        const boostsEl = document.getElementById(DOM_ELEMENT_IDS.BOOSTS) as HTMLSpanElement | null;
        const favsEl = document.getElementById(DOM_ELEMENT_IDS.FAVS) as HTMLSpanElement | null;
        if (repliesEl) repliesEl.textContent = sourcePost.replies_count.toString();
        if (boostsEl) boostsEl.textContent = sourcePost.reblogs_count.toString();
        if (favsEl) favsEl.textContent = sourcePost.favourites_count.toString();

        if (statsEl) {
            statsEl.style.display = visibility.stats ? 'flex' : 'none';
        }

        const shouldShowBottomSection = visibility.timestamp || visibility.stats;
        if (bottomSection) {
            bottomSection.style.display = shouldShowBottomSection ? 'block' : 'none';
            bottomSection.style.borderTopWidth = shouldShowBottomSection ? '1px' : '0';
            bottomSection.style.paddingTop = shouldShowBottomSection ? '1rem' : '0';

            if (!visibility.timestamp && !visibility.stats) {
                bottomSection.style.paddingTop = '0';
                bottomSection.style.borderTopWidth = '0';
            } else if (!visibility.timestamp && visibility.stats) {
                bottomSection.style.paddingTop = '1rem';
            }
        }
    }

    
});
