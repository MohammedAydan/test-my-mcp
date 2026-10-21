/* @refresh reload */
import { render } from 'solid-js/web';
import './styles/tokens.css';
import './styles/nle-layout.css';
import './styles/components.css';
// Phase-1 polish workstreams — imported last so their rules win.
import './styles/project-bin.css';
import './styles/timeline.css';
import './styles/panels.css';
import './styles/inspector.css';
import { App } from './App.js';

const root = document.getElementById('root');

if (root) {
  render(() => <App />, root);
}
