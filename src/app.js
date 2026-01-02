import { WatermarkEngine } from './core/watermarkEngine.js';
import i18n from './i18n.js';
import { loadImage, checkOriginal, getOriginalStatus, setStatusMessage, showLoading, hideLoading } from './utils.js';
import JSZip from 'jszip';
import mediumZoom from 'medium-zoom';

// global state
let engine = null;
let imageQueue = [];
let processedCount = 0;
let zoom = null;
let isCustomMode = false;
let customPosition = null;
let dragState = null;

// dom elements references
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const singlePreview = document.getElementById('singlePreview');
const multiPreview = document.getElementById('multiPreview');
const imageList = document.getElementById('imageList');
const progressText = document.getElementById('progressText');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const originalImage = document.getElementById('originalImage');
const processedSection = document.getElementById('processedSection');
const processedImage = document.getElementById('processedImage');
const originalInfo = document.getElementById('originalInfo');
const processedInfo = document.getElementById('processedInfo');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');

// custom mode elements
const toggleCustomBtn = document.getElementById('toggleCustomBtn');
const watermarkOverlay = document.getElementById('watermarkOverlay');
const watermarkBox = document.getElementById('watermarkBox');

/**
 * initialize the application
 */
async function init() {
    try {
        await i18n.init();
        setupLanguageSwitch();
        showLoading(i18n.t('status.loading'));

        engine = await WatermarkEngine.create();

        hideLoading();
        setupEventListeners();
        setupCustomMode();

        zoom = mediumZoom('[data-zoomable]', {
            margin: 24,
            scrollOffset: 0,
            background: 'rgba(255, 255, 255, .6)',
        })
    } catch (error) {
        hideLoading();
        console.error('initialize error:', error);
    }
}

/**
 * setup language switch
 */
function setupLanguageSwitch() {
    const btn = document.getElementById('langSwitch');
    btn.textContent = i18n.locale === 'zh-CN' ? 'EN' : '中文';
    btn.addEventListener('click', async () => {
        const newLocale = i18n.locale === 'zh-CN' ? 'en-US' : 'zh-CN';
        await i18n.switchLocale(newLocale);
        btn.textContent = newLocale === 'zh-CN' ? 'EN' : '中文';
        updateDynamicTexts();
    });
}

/**
 * setup event listeners
 */
function setupEventListeners() {
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        handleFiles(Array.from(e.dataTransfer.files));
    });

    downloadAllBtn.addEventListener('click', downloadAll);
    resetBtn.addEventListener('click', reset);
}

function reset() {
    singlePreview.style.display = 'none';
    multiPreview.style.display = 'none';
    imageQueue = [];
    processedCount = 0;
    fileInput.value = '';

    // reset custom mode
    isCustomMode = false;
    customPosition = null;
    toggleCustomBtn.style.display = 'none';
    toggleCustomBtn.classList.remove('bg-emerald-50', 'text-emerald-600', 'border-emerald-200');
    toggleCustomBtn.classList.add('bg-white', 'text-gray-600', 'border-gray-200');
    watermarkOverlay.style.display = 'none';
    if (zoom) zoom.attach('#originalImage');
}

function handleFileSelect(e) {
    handleFiles(Array.from(e.target.files));
}

function handleFiles(files) {
    const validFiles = files.filter(file => {
        if (!file.type.match('image/(jpeg|png|webp)')) return false;
        if (file.size > 20 * 1024 * 1024) return false;
        return true;
    });

    if (validFiles.length === 0) return;

    imageQueue.forEach(item => {
        if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
        if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
    });

    imageQueue = validFiles.map((file, index) => ({
        id: Date.now() + index,
        file,
        name: file.name,
        status: 'pending',
        originalImg: null,
        processedBlob: null,
        originalUrl: null,
        processedUrl: null
    }));

    processedCount = 0;

    if (validFiles.length === 1) {
        singlePreview.style.display = 'block';
        multiPreview.style.display = 'none';
        processSingle(imageQueue[0]);
    } else {
        singlePreview.style.display = 'none';
        multiPreview.style.display = 'block';
        imageList.innerHTML = '';
        updateProgress();
        multiPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
        imageQueue.forEach(item => createImageCard(item));
        processQueue();
    }
}

async function processSingle(item, scrollIntoView = true) {
    try {
        const img = await loadImage(item.file);
        item.originalImg = img;

        const { is_google, is_original } = await checkOriginal(item.file);
        const status = getOriginalStatus({ is_google, is_original });
        setStatusMessage(status, is_google && is_original ? 'success' : 'warn');

        originalImage.src = img.src;

        const watermarkInfo = engine.getWatermarkInfo(img.width, img.height);
        originalInfo.innerHTML = `
            <p>${i18n.t('info.size')}: ${img.width}×${img.height}</p>
            <p>${i18n.t('info.watermark')}: ${watermarkInfo.size}×${watermarkInfo.size}</p>
            <p>${i18n.t('info.position')}: (${watermarkInfo.position.x},${watermarkInfo.position.y})</p>
        `;

        // show custom toggle button
        toggleCustomBtn.style.display = 'flex';

        const result = await engine.removeWatermarkFromImage(img, isCustomMode ? customPosition : null);
        const blob = await new Promise(resolve => result.toBlob(resolve, 'image/png'));
        item.processedBlob = blob;

        item.processedUrl = URL.createObjectURL(blob);
        processedImage.src = item.processedUrl;
        processedSection.style.display = 'block';
        downloadBtn.style.display = 'flex';
        downloadBtn.onclick = () => downloadImage(item);

        processedInfo.innerHTML = `
            <p>${i18n.t('info.size')}: ${img.width}×${img.height}</p>
            <p>${i18n.t('info.status')}: ${i18n.t('info.removed')}</p>
        `;

        zoom.detach();
        zoom.attach('[data-zoomable]');

        if (scrollIntoView) {
            processedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } catch (error) {
        console.error(error);
    }
}

function createImageCard(item) {
    const card = document.createElement('div');
    card.id = `card-${item.id}`;
    card.className = 'bg-white md:h-[140px] rounded-xl shadow-card border border-gray-100 overflow-hidden';
    card.innerHTML = `
        <div class="flex flex-wrap h-full">
            <div class="w-full md:w-auto h-full flex border-b border-gray-100">
                <div class="w-24 md:w-48 flex-shrink-0 bg-gray-50 p-2 flex items-center justify-center">
                    <img id="result-${item.id}" class="max-w-full max-h-24 md:max-h-full rounded" data-zoomable />
                </div>
                <div class="flex-1 p-4 flex flex-col min-w-0">
                    <h4 class="font-semibold text-sm text-gray-900 mb-2 truncate">${item.name}</h4>
                    <div class="text-xs text-gray-500" id="status-${item.id}">${i18n.t('status.pending')}</div>
                </div>
            </div>
            <div class="w-full md:w-auto ml-auto flex-shrink-0 p-2 md:p-4 flex items-center justify-center">
                <button id="download-${item.id}" class="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs md:text-sm hidden">${i18n.t('btn.download')}</button>
            </div>
        </div>
    `;
    imageList.appendChild(card);
}

async function processQueue() {
    await Promise.all(imageQueue.map(async item => {
        const img = await loadImage(item.file);
        item.originalImg = img;
        item.originalUrl = img.src;
        document.getElementById(`result-${item.id}`).src = img.src;
        zoom.attach(`#result-${item.id}`);
    }));

    const concurrency = 3;
    for (let i = 0; i < imageQueue.length; i += concurrency) {
        await Promise.all(imageQueue.slice(i, i + concurrency).map(async item => {
            if (item.status !== 'pending') return;

            item.status = 'processing';
            updateStatus(item.id, i18n.t('status.processing'));

            try {
                const result = await engine.removeWatermarkFromImage(item.originalImg);
                const blob = await new Promise(resolve => result.toBlob(resolve, 'image/png'));
                item.processedBlob = blob;

                item.processedUrl = URL.createObjectURL(blob);
                document.getElementById(`result-${item.id}`).src = item.processedUrl;

                item.status = 'completed';
                const watermarkInfo = engine.getWatermarkInfo(item.originalImg.width, item.originalImg.height);

                updateStatus(item.id, `<p>${i18n.t('info.size')}: ${item.originalImg.width}×${item.originalImg.height}</p>
            <p>${i18n.t('info.watermark')}: ${watermarkInfo.size}×${watermarkInfo.size}</p>
            <p>${i18n.t('info.position')}: (${watermarkInfo.position.x},${watermarkInfo.position.y})</p>`, true);

                const downloadBtn = document.getElementById(`download-${item.id}`);
                downloadBtn.classList.remove('hidden');
                downloadBtn.onclick = () => downloadImage(item);

                processedCount++;
                updateProgress();

                checkOriginal(item.originalImg).then(({ is_google, is_original }) => {
                    if (!is_google || !is_original) {
                        const status = getOriginalStatus({ is_google, is_original });
                        const statusEl = document.getElementById(`status-${item.id}`);
                        if (statusEl) statusEl.innerHTML += `<p class="inline-block mt-1 text-xs md:text-sm text-warn">${status}</p>`;
                    }
                }).catch(() => {});
            } catch (error) {
                item.status = 'error';
                updateStatus(item.id, i18n.t('status.failed'));
                console.error(error);
            }
        }));
    }

    if (processedCount > 0) {
        downloadAllBtn.style.display = 'flex';
    }
}

function updateStatus(id, text, isHtml = false) {
    const el = document.getElementById(`status-${id}`);
    if (el) el.innerHTML = isHtml ? text : text.replace(/\n/g, '<br>');
}

function updateProgress() {
    progressText.textContent = `${i18n.t('progress.text')}: ${processedCount}/${imageQueue.length}`;
}

function updateDynamicTexts() {
    if (progressText.textContent) {
        updateProgress();
    }
}

function downloadImage(item) {
    const a = document.createElement('a');
    a.href = item.processedUrl;
    a.download = `unwatermarked_${item.name.replace(/\.[^.]+$/, '')}.png`;
    a.click();
}

async function downloadAll() {
    const completed = imageQueue.filter(item => item.status === 'completed');
    if (completed.length === 0) return;

    const zip = new JSZip();
    completed.forEach(item => {
        const filename = `unwatermarked_${item.name.replace(/\.[^.]+$/, '')}.png`;
        zip.file(filename, item.processedBlob);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `unwatermarked_${Date.now()}.zip`;
    a.click();
}

init();

/**
 * setup custom mode event listeners
 */
function setupCustomMode() {
    toggleCustomBtn.addEventListener('click', toggleCustomMode);

    watermarkBox.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('keydown', handleKeyDown);

    // Add window resize listener to update overlay position
    window.addEventListener('resize', () => {
        if (isCustomMode && customPosition) {
            updateWatermarkOverlay(customPosition);
        }
    });
}

/**
 * Toggle custom watermark mode
 */
function toggleCustomMode() {
    isCustomMode = !isCustomMode;
    const item = imageQueue[0];
    if (!item || !item.originalImg) return;

    if (isCustomMode) {
        // Switch style
        toggleCustomBtn.classList.remove('bg-white', 'text-gray-600', 'border-gray-200');
        toggleCustomBtn.classList.add('bg-emerald-50', 'text-emerald-600', 'border-emerald-200');

        // Show overlay
        watermarkOverlay.style.display = 'block';
        zoom.detach(); // detach zoom to prevent interference

        // Initial position (use existing custom or default)
        if (!customPosition) {
            const info = engine.getWatermarkInfo(item.originalImg.width, item.originalImg.height);
            customPosition = info.position;
        }
        updateWatermarkOverlay(customPosition);
    } else {
        // Revert style
        toggleCustomBtn.classList.remove('bg-emerald-50', 'text-emerald-600', 'border-emerald-200');
        toggleCustomBtn.classList.add('bg-white', 'text-gray-600', 'border-gray-200');

        // Hide overlay
        watermarkOverlay.style.display = 'none';
        zoom.attach('#originalImage'); // re-attach zoom

        // Clear custom position and re-process
        customPosition = null;
        processSingle(item);
    }
}

/**
 * Get image scale factor (Natural / Rendered)
 */
function getScaleFactor() {
    const rect = originalImage.getBoundingClientRect();
    if (rect.width === 0) return 1;
    return originalImage.naturalWidth / rect.width;
}

/**
 * Update watermark overlay position and size
 * @param {Object} pos - position in image coordinates
 */
function updateWatermarkOverlay(pos) {
    const scale = 1 / getScaleFactor();

    watermarkBox.style.left = (pos.x * scale) + 'px';
    watermarkBox.style.top = (pos.y * scale) + 'px';
    watermarkBox.style.width = (pos.width * scale) + 'px';
    watermarkBox.style.height = (pos.height * scale) + 'px';
}

/**
 * Start dragging
 */
function startDrag(e) {
    e.preventDefault();
    if (!isCustomMode) return;

    const scale = getScaleFactor();
    const handle = e.target.getAttribute('data-handle');

    dragState = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: parseFloat(watermarkBox.style.left) || 0,
        startTop: parseFloat(watermarkBox.style.top) || 0,
        startWidth: parseFloat(watermarkBox.style.width) || 0,
        startHeight: parseFloat(watermarkBox.style.height) || 0,
        scale: scale,
        handle: handle
    };
}

/**
 * On dragging
 */
function onDrag(e) {
    if (!dragState) return;
    e.preventDefault();

    const deltaX = (e.clientX - dragState.startX); // Screen pixels
    const deltaY = (e.clientY - dragState.startY);

    if (dragState.handle) {
        // Resizing
        let newWidth = dragState.startWidth;
        let newHeight = dragState.startHeight;
        let newLeft = dragState.startLeft;
        let newTop = dragState.startTop;

        if (dragState.handle.includes('e')) {
            newWidth = Math.max(20, dragState.startWidth + deltaX);
        }
        if (dragState.handle.includes('s')) {
            newHeight = Math.max(20, dragState.startHeight + deltaY);
        }
        if (dragState.handle.includes('w')) {
            const w = Math.max(20, dragState.startWidth - deltaX);
            newLeft = dragState.startLeft + (dragState.startWidth - w);
            newWidth = w;
        }
        if (dragState.handle.includes('n')) {
            const h = Math.max(20, dragState.startHeight - deltaY);
            newTop = dragState.startTop + (dragState.startHeight - h);
            newHeight = h;
        }

        watermarkBox.style.width = newWidth + 'px';
        watermarkBox.style.height = newHeight + 'px';
        watermarkBox.style.left = newLeft + 'px';
        watermarkBox.style.top = newTop + 'px';
    } else {
        // Moving
        let newLeft = dragState.startLeft + deltaX;
        let newTop = dragState.startTop + deltaY;

        watermarkBox.style.left = newLeft + 'px';
        watermarkBox.style.top = newTop + 'px';
    }
}

/**
 * Stop dragging
 */
function stopDrag() {
    if (!dragState) return;
    dragState = null;

    // Update customPosition and process
    const scale = getScaleFactor();

    const domLeft = parseFloat(watermarkBox.style.left) || 0;
    const domTop = parseFloat(watermarkBox.style.top) || 0;
    const domWidth = parseFloat(watermarkBox.style.width) || 0;
    const domHeight = parseFloat(watermarkBox.style.height) || 0;

    customPosition = {
        x: Math.round(domLeft * scale),
        y: Math.round(domTop * scale),
        width: Math.round(domWidth * scale),
        height: Math.round(domHeight * scale)
    };

    // Ensure bounds
    const item = imageQueue[0];
    if (item && item.originalImg) {
        customPosition.x = Math.max(0, Math.min(customPosition.x, item.originalImg.width - customPosition.width));
        customPosition.y = Math.max(0, Math.min(customPosition.y, item.originalImg.height - customPosition.height));
    }

    // Trigger process
    if (item) {
        processSingle(item, false);
    }
}

/**
 * Handle keyboard navigation
 */
let processTimeout;
function handleKeyDown(e) {
    if (!isCustomMode || !customPosition) return;

    // Check if key is relevant
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;

    e.preventDefault();

    const step = 1;
    let { x, y, width, height } = customPosition;

    if (e.shiftKey) {
        // Resize
        switch (e.key) {
            case 'ArrowUp': height -= step; break;
            case 'ArrowDown': height += step; break;
            case 'ArrowLeft': width -= step; break;
            case 'ArrowRight': width += step; break;
        }
    } else {
        // Move
        switch (e.key) {
            case 'ArrowUp': y -= step; break;
            case 'ArrowDown': y += step; break;
            case 'ArrowLeft': x -= step; break;
            case 'ArrowRight': x += step; break;
        }
    }

    // Ensure bounds and minimum size
    const item = imageQueue[0];
    if (item && item.originalImg) {
        // Minimum size 20x20
        width = Math.max(20, width);
        height = Math.max(20, height);

        // Ensure within image bounds
        // If moving, we clamp x,y so box stays inside
        if (!e.shiftKey) {
            x = Math.max(0, Math.min(x, item.originalImg.width - width));
            y = Math.max(0, Math.min(y, item.originalImg.height - height));
        } else {
            // If resizing, we just clamp width/height to not exceed image
            width = Math.min(width, item.originalImg.width - x);
            height = Math.min(height, item.originalImg.height - y);
        }
    }

    customPosition = { x, y, width, height };
    updateWatermarkOverlay(customPosition);

    // Debounce processing
    if (processTimeout) clearTimeout(processTimeout);
    processTimeout = setTimeout(() => {
        if (item) {
            processSingle(item, false);
        }
    }, 50);
}
