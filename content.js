/**
 * FB Marketplace AdBlocker - Content Script
 * Compatible con Brave y Chrome (Manifest V3)
 * Detecta y elimina bloques de publicidad patrocinada en Facebook Marketplace
 */

(() => {
  'use strict';

  // Configuración de palabras clave para detección multi-idioma
  const SPONSORED_KEYWORDS = new Set([
    'publicidad',
    'sponsored',
    'patrocinado',
    'patrocinada',
    'anuncio',
    'anuncios',
    'anuncio patrocinado',
    'publicité',
    'sponsorisé',
    'publicidade',
    'gesponsert',
    'werbung',
    'sponsorizzato',
    'pubblicità'
  ]);

  // Patrones de texto que NUNCA deben ocultarse (información vital del marketplace)
  const PRESERVE_PATTERN = /(informaci[oó]n del vendedor|seller information|detalles del vendedor|seller details|descripci[oó]n del vendedor|seller description|enviar un mensaje|send message|ubicaci[oó]n aproximada|approximate location|art[ií]culos relacionados|related items|art[ií]culos similares|similar items|calificaci[oó]n del vendedor|seller rating)/i;

  let isEnabled = true;
  let blockedCount = 0;
  let updateStorageTimeout = null;

  // Cargar estado inicial desde chrome.storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['adblockEnabled', 'blockedCount'], (result) => {
      if (result.adblockEnabled !== undefined) {
        isEnabled = result.adblockEnabled;
      }
      if (result.blockedCount !== undefined) {
        blockedCount = result.blockedCount;
      }
      if (isEnabled) {
        scanAndRemoveAds();
      }
    });

    // Escuchar cambios de configuración desde el popup
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.adblockEnabled) {
        isEnabled = changes.adblockEnabled.newValue;
        if (isEnabled) {
          scanAndRemoveAds();
        } else {
          restoreHiddenAds();
        }
      }
    });
  }

  // Notificar al storage de nuevos anuncios bloqueados con debounce
  function notifyBlockedIncrement(amount = 1) {
    blockedCount += amount;
    if (updateStorageTimeout) clearTimeout(updateStorageTimeout);
    updateStorageTimeout = setTimeout(() => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ blockedCount });
      }
    }, 500);
  }

  /**
   * Oculta un elemento de forma segura y permanente en la sesión
   */
  function hideAdElement(element, reason = 'ad') {
    if (!element || !(element instanceof HTMLElement)) return false;
    if (element.classList.contains('fb-marketplace-ad-hidden')) return false;

    // Protección de seguridad adicional: nunca ocultar contenedores con vendedor o campos de entrada
    if (isProtectedElement(element)) {
      return false;
    }

    element.classList.add('fb-marketplace-ad-hidden');
    element.style.setProperty('display', 'none', 'important');
    element.style.setProperty('visibility', 'hidden', 'important');
    element.setAttribute('data-fb-ad-blocked-reason', reason);

    notifyBlockedIncrement(1);
    return true;
  }

  /**
   * Restaura elementos en caso de que el usuario desactive la extensión desde el popup
   */
  function restoreHiddenAds() {
    const hiddenElements = document.querySelectorAll('.fb-marketplace-ad-hidden');
    hiddenElements.forEach((el) => {
      el.classList.remove('fb-marketplace-ad-hidden');
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
    });
  }

  /**
   * Verifica si un contenedor contiene datos legítimos del Marketplace que no deben tocarse
   */
  function isProtectedElement(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    
    // Si contiene información del vendedor o descripción
    const text = el.textContent || '';
    if (PRESERVE_PATTERN.test(text)) return true;

    // Si contiene inputs o campos de mensaje ("Enviar un mensaje...")
    if (el.querySelector('input, textarea, [contenteditable="true"]')) return true;

    return false;
  }

  /**
   * Encuentra el contenedor principal del bloque de anuncios a partir del encabezado "Publicidad"
   */
  function findAdContainerFromHeader(headerEl) {
    let current = headerEl;
    let candidate = null;

    // Subir hasta 8 niveles buscando el límite del contenedor
    for (let i = 0; i < 8; i++) {
      const parent = current.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) {
        break;
      }

      // Si el elemento padre contiene secciones protegidas (ej. vendedor, descripción, mensaje),
      // significa que 'current' es el contenedor del bloque de publicidad aislado
      if (isProtectedElement(parent)) {
        if (!isProtectedElement(current)) {
          candidate = current;
        }
        break;
      }

      current = parent;
    }

    return candidate;
  }

  /**
   * 1. Elimina el bloque lateral de anuncios en la vista de artículo (Marketplace Item View)
   */
  function cleanItemViewAds() {
    // Buscar encabezados o etiquetas con texto "Publicidad", "Sponsored", etc.
    const potentialHeaders = document.querySelectorAll('span, div, h2, h3, h4');

    for (const el of potentialHeaders) {
      if (el.children.length > 2) continue; // Solo nos interesan nodos de texto / etiquetas
      const text = el.textContent ? el.textContent.trim().toLowerCase() : '';

      if (SPONSORED_KEYWORDS.has(text)) {
        // Encontrar el contenedor del anuncio
        const container = findAdContainerFromHeader(el);
        if (container) {
          hideAdElement(container, 'item-sidebar-ad-section');
        }
      }
    }
  }

  /**
   * 2. Detecta y elimina anuncios por enlaces publicitarios de Meta
   */
  function cleanByAdLinks() {
    // Selectores de enlaces y atributos típicos de publicidad en Facebook
    const adSelectors = [
      'a[href*="/ads/about"]',
      'a[href*="/ad_preferences"]',
      'a[href*="facebook.com/ad_preferences"]',
      'a[href*="help/1614760982071987"]', // "¿Por qué veo este anuncio?"
      'div[aria-label="Publicidad" i]',
      'div[aria-label="Sponsored" i]',
      'div[aria-label="Patrocinado" i]',
      'button[aria-label*="Opciones de anuncio" i]',
      'button[aria-label*="Ad options" i]',
      'div[data-ad-preview]',
      'div[data-ad-comet-preview]'
    ];

    const elements = document.querySelectorAll(adSelectors.join(', '));

    for (const el of elements) {
      const container = findAdContainerFromHeader(el);
      if (container) {
        hideAdElement(container, 'ad-link-reference');
      } else {
        // Si no se encuentra con la búsqueda hacia arriba, intentar con el contenedor más cercano
        const card = el.closest('[role="region"], [role="listitem"], [role="article"]') || el.parentElement;
        if (card && !isProtectedElement(card)) {
          hideAdElement(card, 'ad-closest-card');
        }
      }
    }
  }

  /**
   * 3. Elimina publicaciones patrocinadas en el feed principal o cuadrícula de Marketplace
   */
  function cleanMarketplaceFeedSponsored() {
    // Si no estamos en una vista de feed o marketplace, salir
    const isMarketplace = window.location.pathname.includes('/marketplace');
    if (!isMarketplace) return;

    // Buscar elementos en el feed que indiquen patrocinio
    const allLabels = document.querySelectorAll('span[dir="auto"], div[dir="auto"]');

    for (const el of allLabels) {
      if (el.children.length > 2) continue;
      const text = el.textContent ? el.textContent.trim().toLowerCase() : '';

      if (SPONSORED_KEYWORDS.has(text)) {
        // Buscar la tarjeta del producto en la cuadrícula
        // Generalmente una tarjeta de producto está dentro de un elemento con role="link" o un contenedor de cuadrícula
        let card = el.closest('div[style*="max-width"], div[role="feed"] > div, div[role="article"]');
        
        // Si no encontró por rol, subir 4 a 6 niveles
        if (!card) {
          let curr = el;
          for (let i = 0; i < 6; i++) {
            if (!curr.parentElement) break;
            curr = curr.parentElement;
            // Si tiene imagen y enlaces hacia marketplace, es la tarjeta
            if (curr.querySelector('img') && curr.querySelector('a[href*="/marketplace/item/"]')) {
              card = curr;
              break;
            }
          }
        }

        if (card && !isProtectedElement(card)) {
          hideAdElement(card, 'feed-sponsored-item');
        }
      }
    }
  }

  /**
   * Escaneo maestro que ejecuta todas las estrategias
   */
  function scanAndRemoveAds() {
    if (!isEnabled) return;

    try {
      cleanItemViewAds();
      cleanByAdLinks();
      cleanMarketplaceFeedSponsored();
    } catch (err) {
      // Prevenir que errores inesperados detengan la página
      console.debug('[FB Marketplace AdBlocker] Scan cycle error:', err);
    }
  }

  // Ejecución inicial rápida
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndRemoveAds);
  } else {
    scanAndRemoveAds();
  }

  // Observer de alto rendimiento con throttle por requestAnimationFrame
  let isThrottled = false;
  const observer = new MutationObserver(() => {
    if (!isEnabled || isThrottled) return;

    isThrottled = true;
    requestAnimationFrame(() => {
      scanAndRemoveAds();
      isThrottled = false;
    });
  });

  // Iniciar observación en document.documentElement o body
  const targetNode = document.body || document.documentElement;
  if (targetNode) {
    observer.observe(targetNode, {
      childList: true,
      subtree: true
    });
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    });
  }

  // Escuchar cambios de URL en Facebook (Single Page Application SPA)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scanAndRemoveAds();
    }
  }, 400);

})();
