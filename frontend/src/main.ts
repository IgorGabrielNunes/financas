import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import '@fontsource-variable/onest';
import './style.css';

createApp(App).use(router).mount('#app');
