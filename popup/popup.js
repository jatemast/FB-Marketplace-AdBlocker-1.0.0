document.addEventListener('DOMContentLoaded', () => {
  const toggleBlocker = document.getElementById('toggleBlocker');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const statusSubtext = document.getElementById('statusSubtext');
  const blockedCountDisplay = document.getElementById('blockedCountDisplay');
  const btnResetCount = document.getElementById('btnResetCount');

  // Actualizar la interfaz según el estado
  function updateUI(isEnabled, count) {
    toggleBlocker.checked = isEnabled;
    blockedCountDisplay.textContent = count !== undefined ? count : 0;

    if (isEnabled) {
      statusDot.classList.remove('disabled');
      statusText.textContent = 'Protección Activa';
      statusSubtext.textContent = 'Bloqueando publicidad en Marketplace';
    } else {
      statusDot.classList.add('disabled');
      statusText.textContent = 'Protección Desactivada';
      statusSubtext.textContent = 'Los anuncios se mostrarán normalmente';
    }
  }

  // Cargar valores guardados
  chrome.storage.local.get(['adblockEnabled', 'blockedCount'], (result) => {
    const isEnabled = result.adblockEnabled !== undefined ? result.adblockEnabled : true;
    const count = result.blockedCount !== undefined ? result.blockedCount : 0;
    updateUI(isEnabled, count);
  });

  // Manejar cambio en el interruptor
  toggleBlocker.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ adblockEnabled: isEnabled }, () => {
      chrome.storage.local.get(['blockedCount'], (res) => {
        updateUI(isEnabled, res.blockedCount || 0);
      });
    });
  });

  // Manejar reinicio del contador
  btnResetCount.addEventListener('click', () => {
    chrome.storage.local.set({ blockedCount: 0 }, () => {
      blockedCountDisplay.textContent = '0';
    });
  });

  // Escuchar cambios en tiempo real
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.blockedCount) {
        blockedCountDisplay.textContent = changes.blockedCount.newValue || 0;
      }
      if (changes.adblockEnabled) {
        chrome.storage.local.get(['blockedCount'], (res) => {
          updateUI(changes.adblockEnabled.newValue, res.blockedCount || 0);
        });
      }
    }
  });
});
