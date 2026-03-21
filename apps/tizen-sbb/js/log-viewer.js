(function() {
  var LogViewer = {
    refreshInterval: null,
    lastUpdatedAt: '0',

    init: function() {
      this.textarea = document.getElementById('log-export-text');
      this.status = document.getElementById('log-export-status');
      this.refreshButton = document.getElementById('log-refresh-button');
      this.copyButton = document.getElementById('log-copy-button');
      this.clearButton = document.getElementById('log-clear-button');
      this.backButton = document.getElementById('log-back-button');

      if (this.refreshButton) this.refreshButton.addEventListener('click', this.refresh.bind(this));
      if (this.copyButton) this.copyButton.addEventListener('click', this.copyAll.bind(this));
      if (this.clearButton) this.clearButton.addEventListener('click', this.clear.bind(this));
      if (this.backButton) this.backButton.addEventListener('click', this.goBack.bind(this));

      document.addEventListener('keydown', this.handleKeyDown.bind(this));
      window.addEventListener('beforeunload', this.destroy.bind(this));

      this.refresh();
      this.refreshInterval = window.setInterval(this.refreshIfChanged.bind(this), 1000);
    },

    getEntries: function() {
      if (typeof PersistentLogStore !== 'undefined') {
        return PersistentLogStore.load();
      }
      return [];
    },

    refreshIfChanged: function() {
      if (typeof PersistentLogStore === 'undefined') return;
      var updatedAt = PersistentLogStore.getUpdatedAt();
      if (updatedAt !== this.lastUpdatedAt) {
        this.refresh();
      }
    },

    refresh: function() {
      var entries = this.getEntries();
      var text = typeof PersistentLogStore !== 'undefined'
        ? PersistentLogStore.exportText(entries)
        : '';
      var wasAtBottom = this.isNearBottom();

      if (this.textarea) {
        this.textarea.value = text || 'No persisted logs yet.';
        if (wasAtBottom) {
          this.textarea.scrollTop = this.textarea.scrollHeight;
        }
      }

      if (typeof PersistentLogStore !== 'undefined') {
        this.lastUpdatedAt = PersistentLogStore.getUpdatedAt();
      }

      this.setStatus(entries.length + ' logs loaded' + (entries.length ? ' | Updated ' + new Date().toLocaleTimeString() : ''));
    },

    copyAll: function() {
      var text = this.textarea ? this.textarea.value : '';
      if (!text) {
        this.setStatus('No log text to copy');
        return;
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(this.handleCopySuccess.bind(this), this.copyWithSelection.bind(this));
        return;
      }

      this.copyWithSelection();
    },

    copyWithSelection: function() {
      if (!this.textarea) return;
      this.textarea.focus();
      this.textarea.select();
      this.textarea.setSelectionRange(0, this.textarea.value.length);
      try {
        if (document.execCommand('copy')) {
          this.handleCopySuccess();
          return;
        }
      } catch (error) {}
      this.setStatus('Text selected. Copy manually from the page.');
    },

    handleCopySuccess: function() {
      this.setStatus('All logs copied');
    },

    clear: function() {
      if (typeof PersistentLogStore !== 'undefined') {
        PersistentLogStore.clear();
      }
      if (typeof UiLog !== 'undefined') {
        UiLog.clear();
      }
      this.refresh();
      this.setStatus('Persisted logs cleared');
    },

    goBack: function() {
      window.location.href = 'index.html';
    },

    handleKeyDown: function(event) {
      if (!this.textarea) return;

      if (event.keyCode === 10009 || event.keyCode === 18) {
        event.preventDefault();
        this.goBack();
        return;
      }

      if (event.keyCode === 38) {
        event.preventDefault();
        this.textarea.scrollTop = Math.max(0, this.textarea.scrollTop - Math.max(120, Math.floor(this.textarea.clientHeight * 0.75)));
        return;
      }

      if (event.keyCode === 40) {
        event.preventDefault();
        this.textarea.scrollTop = Math.min(this.textarea.scrollHeight, this.textarea.scrollTop + Math.max(120, Math.floor(this.textarea.clientHeight * 0.75)));
      }
    },

    isNearBottom: function() {
      if (!this.textarea) return true;
      return this.textarea.scrollTop + this.textarea.clientHeight >= this.textarea.scrollHeight - 24;
    },

    setStatus: function(message) {
      if (this.status) {
        this.status.textContent = message;
      }
    },

    destroy: function() {
      if (this.refreshInterval) {
        window.clearInterval(this.refreshInterval);
        this.refreshInterval = null;
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.LogViewer = LogViewer;
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
      LogViewer.init();
    });
  }
})();