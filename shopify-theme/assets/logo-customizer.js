/**
 * Logo Customizer - Main JavaScript Logic
 * Handles logo upload, API integration, and sample display
 */

(function() {
  'use strict';

  // Configuration
  const config = {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/svg+xml'],
    apiProxyUrl: window.logoCustomizerConfig?.apiProxyUrl || '/apps/zoomcatalog-proxy',
    productAssetId: window.logoCustomizerConfig?.productAssetId || '77ADAF4B723BC485CABE56964B763A50'
  };

  // State
  let currentImageUrl = null;
  let currentFile = null;

  // DOM Elements
  const elements = {
    fileInput: document.getElementById('logo-file-input'),
    browseBtn: document.getElementById('browse-files-btn'),
    fileUploadArea: document.getElementById('file-upload-area'),
    filePreview: document.getElementById('file-preview'),
    previewImage: document.getElementById('preview-image'),
    previewFilename: document.getElementById('preview-filename'),
    removePreview: document.getElementById('remove-preview'),
    urlInput: document.getElementById('logo-url-input'),
    validateUrlBtn: document.getElementById('validate-url-btn'),
    urlPreview: document.getElementById('url-preview'),
    urlPreviewImage: document.getElementById('url-preview-image'),
    removeUrlPreview: document.getElementById('remove-url-preview'),
    errorMessage: document.getElementById('error-message'),
    generateBtn: document.getElementById('generate-sample-btn'),
    modal: document.getElementById('product-sample-modal'),
    modalOverlay: document.getElementById('modal-overlay'),
    modalClose: document.getElementById('modal-close'),
    modalLoading: document.getElementById('modal-loading'),
    modalSample: document.getElementById('modal-sample'),
    modalError: document.getElementById('modal-error'),
    modalErrorMessage: document.getElementById('modal-error-message'),
    sampleImage: document.getElementById('sample-image'),
    regenerateBtn: document.getElementById('regenerate-sample-btn'),
    addToCartBtn: document.getElementById('add-to-cart-sample-btn'),
    errorRetryBtn: document.getElementById('error-retry-btn'),
    tabButtons: document.querySelectorAll('.tab-button')
  };

  // Initialize
  function init() {
    if (!elements.fileInput) return;

    setupEventListeners();
    setupDragAndDrop();
    setupTabs();
  }

  // Setup Event Listeners
  function setupEventListeners() {
    // File upload
    if (elements.browseBtn) {
      elements.browseBtn.addEventListener('click', () => elements.fileInput?.click());
    }
    if (elements.fileInput) {
      elements.fileInput.addEventListener('change', handleFileSelect);
    }
    if (elements.removePreview) {
      elements.removePreview.addEventListener('click', clearFilePreview);
    }

    // URL input
    if (elements.validateUrlBtn) {
      elements.validateUrlBtn.addEventListener('click', handleURLInput);
    }
    if (elements.urlInput) {
      elements.urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleURLInput();
      });
    }
    if (elements.removeUrlPreview) {
      elements.removeUrlPreview.addEventListener('click', clearUrlPreview);
    }

    // Generate sample
    if (elements.generateBtn) {
      elements.generateBtn.addEventListener('click', generateCustomizedSample);
    }

    // Modal
    if (elements.modalClose) {
      elements.modalClose.addEventListener('click', closeModal);
    }
    if (elements.modalOverlay) {
      elements.modalOverlay.addEventListener('click', closeModal);
    }
    if (elements.regenerateBtn) {
      elements.regenerateBtn.addEventListener('click', () => {
        closeModal();
        clearAllPreviews();
      });
    }
    if (elements.errorRetryBtn) {
      elements.errorRetryBtn.addEventListener('click', () => {
        hideError();
        if (currentImageUrl) {
          generateCustomizedSample();
        }
      });
    }

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isModalOpen()) {
        closeModal();
      }
    });
  }

  // Setup Drag and Drop
  function setupDragAndDrop() {
    if (!elements.fileUploadArea) return;

    elements.fileUploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      elements.fileUploadArea.classList.add('dragover');
    });

    elements.fileUploadArea.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      elements.fileUploadArea.classList.remove('dragover');
    });

    elements.fileUploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      elements.fileUploadArea.classList.remove('dragover');

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    });
  }

  // Setup Tabs
  function setupTabs() {
    elements.tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tabName = button.dataset.tab;
        switchTab(tabName);
      });
    });
  }

  function switchTab(tabName) {
    // Update buttons
    elements.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `${tabName}-tab`);
    });

    // Clear error when switching tabs
    hideError();
  }

  // Handle File Select
  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      handleFile(file);
    }
  }

  // Handle File
  function handleFile(file) {
    // Validate file
    if (!validateFile(file)) {
      return;
    }

    currentFile = file;
    currentImageUrl = null; // Clear URL when file is selected

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      if (elements.previewImage) {
        elements.previewImage.src = e.target.result;
      }
      if (elements.previewFilename) {
        elements.previewFilename.textContent = file.name;
      }
      if (elements.filePreview) {
        elements.filePreview.style.display = 'block';
      }
      updateGenerateButton();
    };
    reader.readAsDataURL(file);
  }

  // Validate File
  function validateFile(file) {
    hideError();

    if (!file) {
      showError('Please select a file');
      return false;
    }

    if (file.size > config.maxFileSize) {
      showError(`File size exceeds ${config.maxFileSize / 1024 / 1024}MB limit`);
      return false;
    }

    if (!config.allowedTypes.includes(file.type)) {
      showError('Invalid file type. Please upload an image (JPG, PNG, GIF, SVG)');
      return false;
    }

    return true;
  }

  // Handle URL Input
  function handleURLInput() {
    const url = elements.urlInput?.value.trim();
    hideError();

    if (!url) {
      showError('Please enter an image URL');
      return;
    }

    if (!isValidUrl(url)) {
      showError('Please enter a valid URL');
      return;
    }

    // Validate image URL by trying to load it
    validateImageUrl(url);
  }

  // Validate Image URL
  function validateImageUrl(url) {
    const img = new Image();
    img.onload = () => {
      currentImageUrl = url;
      currentFile = null; // Clear file when URL is used

      if (elements.urlPreviewImage) {
        elements.urlPreviewImage.src = url;
      }
      if (elements.urlPreview) {
        elements.urlPreview.style.display = 'block';
      }
      updateGenerateButton();
    };
    img.onerror = () => {
      showError('Unable to load image from URL. Please check the URL and try again.');
    };
    img.src = url;
  }

  // Validate URL Format
  function isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  // Clear File Preview
  function clearFilePreview() {
    if (elements.fileInput) elements.fileInput.value = '';
    if (elements.filePreview) elements.filePreview.style.display = 'none';
    if (elements.previewImage) elements.previewImage.src = '';
    currentFile = null;
    updateGenerateButton();
  }

  // Clear URL Preview
  function clearUrlPreview() {
    if (elements.urlInput) elements.urlInput.value = '';
    if (elements.urlPreview) elements.urlPreview.style.display = 'none';
    if (elements.urlPreviewImage) elements.urlPreviewImage.src = '';
    currentImageUrl = null;
    updateGenerateButton();
  }

  // Clear All Previews
  function clearAllPreviews() {
    clearFilePreview();
    clearUrlPreview();
  }

  // Update Generate Button State
  function updateGenerateButton() {
    const hasImage = currentFile || currentImageUrl;
    if (elements.generateBtn) {
      elements.generateBtn.disabled = !hasImage;
    }
  }

  // Show Error
  function showError(message) {
    if (elements.errorMessage) {
      elements.errorMessage.textContent = message;
      elements.errorMessage.style.display = 'block';
    }
  }

  // Hide Error
  function hideError() {
    if (elements.errorMessage) {
      elements.errorMessage.style.display = 'none';
    }
  }

  // Generate Customized Sample
  async function generateCustomizedSample() {
    if (!currentFile && !currentImageUrl) {
      showError('Please upload a logo or enter an image URL');
      return;
    }

    hideError();
    showModal();
    showLoading();

    try {
      let imageUrl = currentImageUrl;

      // If file is selected, upload it first
      if (currentFile) {
        imageUrl = await uploadToShopifyFiles(currentFile);
        if (!imageUrl) {
          throw new Error('Failed to upload image');
        }
      }

      // Generate sample via API
      const sampleUrl = await callZoomCatalogAPI(imageUrl);
      
      if (sampleUrl) {
        displaySample(sampleUrl);
      } else {
        throw new Error('Failed to generate sample');
      }
    } catch (error) {
      console.error('Error generating sample:', error);
      showModalError(error.message || 'An error occurred while generating your sample. Please try again.');
    }
  }

  // Upload to Shopify Files (Placeholder - requires backend implementation)
  async function uploadToShopifyFiles(file) {
    // For now, convert to data URL or use a placeholder
    // In production, this should upload to Shopify Files API or external storage
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        // Return data URL as temporary solution
        // TODO: Implement actual Shopify Files API upload
        resolve(e.target.result);
      };
      reader.readAsDataURL(file);
    });
  }

  // Call ZoomCatalog API
  async function callZoomCatalogAPI(imageUrl) {
    const response = await fetch(config.apiProxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productId: config.productAssetId,
        imageUrl: imageUrl
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || `API error: ${response.status}`);
    }

    const data = await response.json();
    return data.sampleUrl;
  }

  // Show Modal
  function showModal() {
    if (elements.modal) {
      elements.modal.style.display = 'block';
      document.body.style.overflow = 'hidden';
    }
  }

  // Close Modal
  function closeModal() {
    if (elements.modal) {
      elements.modal.style.display = 'none';
      document.body.style.overflow = '';
    }
    hideLoading();
    hideSample();
    hideModalError();
  }

  // Is Modal Open
  function isModalOpen() {
    return elements.modal && elements.modal.style.display === 'block';
  }

  // Show Loading
  function showLoading() {
    if (elements.modalLoading) elements.modalLoading.style.display = 'block';
    if (elements.modalSample) elements.modalSample.style.display = 'none';
    if (elements.modalError) elements.modalError.style.display = 'none';
  }

  // Hide Loading
  function hideLoading() {
    if (elements.modalLoading) elements.modalLoading.style.display = 'none';
  }

  // Display Sample
  function displaySample(sampleUrl) {
    hideLoading();
    if (elements.sampleImage) {
      elements.sampleImage.src = sampleUrl;
    }
    if (elements.modalSample) {
      elements.modalSample.style.display = 'block';
    }
  }

  // Hide Sample
  function hideSample() {
    if (elements.modalSample) elements.modalSample.style.display = 'none';
  }

  // Show Modal Error
  function showModalError(message) {
    hideLoading();
    if (elements.modalErrorMessage) {
      elements.modalErrorMessage.textContent = message;
    }
    if (elements.modalError) {
      elements.modalError.style.display = 'block';
    }
  }

  // Hide Modal Error
  function hideModalError() {
    if (elements.modalError) elements.modalError.style.display = 'none';
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

