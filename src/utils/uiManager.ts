import { templateManager } from './templateManager';
import { imageGenerator } from './imageGenerator';
import { domCache } from './domCache';
import { DOM_ELEMENT_IDS } from '../constants';
import type { MastodonStatus, MastodonMediaAttachment } from '../types/mastodon';

interface PrefetchedMetaData {
    postData: MastodonStatus;
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

    let postData: MastodonStatus | null = null;
    let fetchedInstance = '';
    let imageMap: Record<string, string> = {};
    let visibility = { stats: true, timestamp: true, instance: true };
    let eventSource: EventSource | null = null;

    generateBtn?.addEventListener('click', fetchMastodonPost);
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

    async function fetchMastodonPost() {
        if (eventSource) eventSource.close();
        
        const url = urlInput?.value.trim();
        if (!url) return showError('Please enter a URL.');

        if (previewArea) previewArea.classList.remove('hidden');
        setGenerateButtonState(true);
        setPreviewState('loading');
        if (previewStatus) {
            previewStatus.textContent = 'Fetching post...';
            previewStatus.className = 'text-sm text-blue-600';
        }

        try {
            const metaResponse = await fetch('/api/fetch-post-meta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            if (!metaResponse.ok) {
                const errorData = await metaResponse.json().catch(() => ({ error: 'An unknown server error occurred' }));
                throw new Error(errorData.error || `Server error: ${metaResponse.statusText}`);
            }
            const metaData: PrefetchedMetaData = await metaResponse.json();
            
            postData = metaData.postData;
            fetchedInstance = metaData.fetchedInstance;
            imageMap = metaData.imageMap;

            renderPreview();
            if (downloadBtn) downloadBtn.disabled = true;

            if (metaData.imageUrls.length === 0) {
                if (previewStatus) {
                    previewStatus.textContent = 'Preview loaded successfully';
                    previewStatus.className = 'text-sm text-green-600';
                }
                if(downloadBtn) downloadBtn.disabled = false;
                setGenerateButtonState(false);
                return;
            }
            
            if (previewStatus) {
                previewStatus.textContent = `Loading images (0/${metaData.imageUrls.length})...`;
            }

            const encodedUrls = encodeURIComponent(metaData.imageUrls.join(','));
            eventSource = new EventSource(`/api/stream-images?urls=${encodedUrls}`);
            let loadedImages = 0;
            const totalImages = metaData.imageUrls.length;

            eventSource.onmessage = (event) => {
                const data: StreamedImageData = JSON.parse(event.data);
                loadedImages++;
                if (data.url) {
                    imageMap[data.url] = data.dataUrl;
                    renderPreview(); // 【Key Fix】Redraw the entire preview after receiving an image
                }
                if (previewStatus) {
                     previewStatus.textContent = `Loading images (${loadedImages}/${totalImages})...`;
                }
                 if(loadedImages >= totalImages){
                     handleStreamEnd();
                }
            };
            
            const handleStreamEnd = () => {
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                }
                if (previewStatus && previewStatus.textContent?.includes('Loading')) {
                    previewStatus.textContent = 'Preview loaded successfully';
                    previewStatus.className = 'text-sm text-green-600';
                }
                if(downloadBtn) downloadBtn.disabled = false;
                setGenerateButtonState(false);
            };

            eventSource.onerror = (err) => {
                console.error("EventSource failed:", err);
                handleStreamEnd();
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

        // If the post is a reblog, use the original post's data for rendering.
        const sourcePost: MastodonStatus = postData.reblog || postData;

        // --- 1. Process Content and Emojis ---
        // Sanitize and prepare the main post content.
        let contentHTML = sourcePost.content;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = contentHTML;
        // Ensure external links have a specific class for styling.
        tempDiv.querySelectorAll('a:not(.mention):not(.hashtag)').forEach(link => link.classList.add('url'));
        contentHTML = tempDiv.innerHTML;
        
        // Replace emoji shortcodes with their corresponding images from the pre-loaded imageMap.
        const allEmojis = [...(sourcePost.emojis || []), ...(sourcePost.account.emojis || [])];
        allEmojis.forEach(emoji => {
            const dataUrl = imageMap[emoji.url];
            const imgTag = `<img src="${dataUrl || ''}" alt=":${emoji.shortcode}:" class="custom-emoji" ${!dataUrl ? 'style="opacity:0; width:0; height:0;"' : ''}>`;
            contentHTML = contentHTML.replaceAll(`:${emoji.shortcode}:`, dataUrl ? imgTag : `:${emoji.shortcode}:`);
        });

        // Also process any emojis within the user's display name.
        let displayNameHTML = sourcePost.account.display_name;
        (sourcePost.account.emojis || []).forEach(emoji => {
             const dataUrl = imageMap[emoji.url];
             const imgTag = `<img src="${dataUrl || ''}" alt=":${emoji.shortcode}:" class="custom-emoji" ${!dataUrl ? 'style="opacity:0; width:0; height:0;"' : ''}>`;
             displayNameHTML = displayNameHTML.replaceAll(`:${emoji.shortcode}:`, dataUrl ? imgTag : `:${emoji.shortcode}:`);
        });

        // --- 2. Render User and Content Information ---
        // Inject the processed content into the DOM.
        (domCache.getElement(DOM_ELEMENT_IDS.CONTENT) as HTMLDivElement).innerHTML = contentHTML;
        
        // Render the user's avatar, display name, and username.
        (domCache.getElement(DOM_ELEMENT_IDS.AVATAR_CONTAINER) as HTMLDivElement).innerHTML = `<img class="w-12 h-12 rounded-lg" alt="Avatar" src="${imageMap[sourcePost.account.avatar] || '/favicon.svg'}">`;
        (domCache.getElement(DOM_ELEMENT_IDS.DISPLAY_NAME) as HTMLDivElement).innerHTML = displayNameHTML;

        // Construct the username, optionally including the instance name based on visibility settings.
        const usernameEl = domCache.getElement(DOM_ELEMENT_IDS.USERNAME) as HTMLDivElement;
        const { acct } = sourcePost.account;
        const usernamePart = acct.includes('@') ? acct.split('@')[0] : acct;
        const instancePart = acct.includes('@') ? acct.split('@').slice(1).join('@') : fetchedInstance;
        usernameEl.textContent = visibility.instance && instancePart ? `@${usernamePart}@${instancePart}` : `@${usernamePart}`;

        // --- 3. Render Media and Footer ---
        // Render media attachments like images and videos.
        renderMedia(sourcePost.media_attachments, imageMap);

        // Format the date and time for the footer display.
        const date = new Date(sourcePost.created_at);
        const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const formattedTime = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        
        // Render the footer section, which includes stats and the timestamp.
        renderFooter(sourcePost, visibility, formattedTime, formattedDate);

        // --- 4. Finalize UI State ---
        // Show the populated preview card.
        setPreviewState('content');
    }
    
    /**
     * Renders media attachments (images/videos) into the preview card.
     * @param attachments - The list of media attachments from the post.
     * @param imgMap - A map of image URLs to their Base64 data URLs.
     */
    function renderMedia(attachments: MastodonMediaAttachment[], imgMap: Record<string, string>) {
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
        if (toDisplay.length >= 2) container.style.aspectRatio = '3 / 2';
        container.style.gridTemplateColumns = toDisplay.length > 1 ? '1fr 1fr' : '1fr';

        toDisplay.forEach((att, index) => {
            const url = att.type === 'image' ? att.url : (att.preview_url || att.url);
            const dataUrl = imgMap[url];
            const wrapper = document.createElement('div');
            wrapper.className = 'overflow-hidden relative';

            if (dataUrl && dataUrl !== 'failed') {
                wrapper.innerHTML = `<img alt="${att.description || `Attachment ${index + 1}`}" class="w-full h-full object-cover" src="${dataUrl}">`;
            } else if (dataUrl === 'failed') {
                wrapper.innerHTML = `<div class="w-full h-full bg-gray-200 flex items-center justify-center text-gray-500"><svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg></div>`;
            } else {
                wrapper.innerHTML = `<div class="w-full h-full shimmer"></div>`;
            }

            if (att.type === 'gifv') wrapper.innerHTML += `<div class="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded z-10">GIF</div>`;
            if (att.type === 'video') wrapper.innerHTML += `<div class="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded flex items-center z-10"><svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v8a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z"/></svg>Video</div>`;
            if (toDisplay.length === 3 && index === 0) wrapper.style.gridRow = 'span 2 / span 2';
            
            container.appendChild(wrapper);
        });
    }
    
    // --- Helper functions ---
    function renderFooter(post: MastodonStatus, vis: typeof visibility, time: string, date: string) {
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

        (domCache.getElement(DOM_ELEMENT_IDS.REPLIES) as HTMLSpanElement).textContent = post.replies_count.toString();
        (domCache.getElement(DOM_ELEMENT_IDS.BOOSTS) as HTMLSpanElement).textContent = post.reblogs_count.toString();
        (domCache.getElement(DOM_ELEMENT_IDS.FAVS) as HTMLSpanElement).textContent = post.favourites_count.toString();

        const showBottom = vis.timestamp || vis.stats;
        if (bottomSection) {
            bottomSection.style.display = showBottom ? 'block' : 'none';
            bottomSection.style.borderTopWidth = showBottom ? '1px' : '0';
            bottomSection.style.paddingTop = showBottom ? '1rem' : '0';
        }
    }
    function setPreviewState(state: 'loading' | 'content' | 'error') { if(loader) loader.classList.add('hidden'); if(styleAContainer) styleAContainer.classList.add('hidden'); if(state === 'loading' && loader) { loader.classList.remove('hidden'); if(previewStatus) previewStatus.textContent = 'Loading...'; } else if(state === 'content' && styleAContainer) { styleAContainer.classList.remove('hidden'); } else if (state === 'error' && previewStatus) { if(previewStatus) previewStatus.textContent = 'Error loading preview'; if(previewStatus) previewStatus.className = 'text-sm text-red-600'; } }
    function setGenerateButtonState(isLoading: boolean) { if(generateBtn) { generateBtn.disabled = isLoading; generateBtn.textContent = isLoading ? 'Fetching...' : 'Generate Preview'; } }
    function showError(message: string) { if(errorMessage) errorMessage.textContent = message; if(previewArea) previewArea.classList.add('hidden'); if(downloadBtn) downloadBtn.disabled = true; setPreviewState('error'); }
    function toggleClearButtonVisibility() { if (urlInput && clearUrlBtn) { urlInput.value.trim().length > 0 ? clearUrlBtn.classList.remove('hidden') : clearUrlBtn.classList.add('hidden'); } }
    function clearUrlInput() { if (urlInput) { urlInput.value = ''; toggleClearButtonVisibility(); urlInput.focus(); } }
    function toggleAccordion(content: HTMLElement | null, icon: SVGElement | null, button: HTMLElement | null) { if (content && icon && button) { const isExpanded = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!isExpanded)); icon.classList.toggle('rotate-180'); content.classList.toggle('hidden'); } }
});
