// Fullscreen image viewer state. Any <img data-zoom> opens via the Lightbox click listener; code can call openLightbox().
export const lightbox = $state<{ src: string | null; alt: string }>({ src: null, alt: '' });
export const openLightbox = (src: string, alt = '') => { lightbox.src = src; lightbox.alt = alt; };
export const closeLightbox = () => { lightbox.src = null; };
