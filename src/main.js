import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { startLoaderEyes } from './ui/loaderEyes.js';
import { installLanguage } from './i18n/language.js';
import {
  installAutoHideScrollbars,
  installHorizontalWheel,
} from './ui/autoHideScrollbars.js';
import { installTooltips } from './ui/tooltips.js';
import { installCustomSelects } from './ui/customSelect.js';

// Interface language first (Spanish by default), so every surface renders
// translated from its first paint.
// Tooltips first: they adopt titles in their authored form for translation.
installTooltips(document);
installLanguage(document);
installAutoHideScrollbars(document);
installHorizontalWheel(document);
installCustomSelects(document);

// Start the loading-screen animation before the heavy application setup.
startLoaderEyes(document.getElementById('loading-screen'));

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().catch((error) => {
  console.error('PANOPTES initialization failed:', error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `Error: ${describeError(error)}`;
  loaderStatus.style.color = '#ff4444';
});

export { application };
