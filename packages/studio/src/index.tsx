/* @refresh reload */
import { render } from 'solid-js/web';
import './styles/tokens.css';
import './styles/nle-layout.css';
import './styles/components.css';
import { App } from './App.js';

const root = document.getElementById('root');

if (root) {
  render(() => <App />, root);
}
