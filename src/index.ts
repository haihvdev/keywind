import './index.css';

import Alpine from 'alpinejs';

import { initCadastralBackground } from './data/cadastralBackground';

window.Alpine = Alpine;

initCadastralBackground();

Alpine.start();
