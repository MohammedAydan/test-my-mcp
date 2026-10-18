/* @refresh reload */
import { render } from 'solid-js/web';
import './styles.css';
import { App } from './App.js';

const root = document.getElementById('root');

if (root) {
  render(() => <App />, root);
}
