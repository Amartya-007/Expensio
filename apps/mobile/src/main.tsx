import { Buffer } from 'buffer';
// @powersync/web needs a global Buffer polyfill when it isn't provided by
// the runtime — see the Web SDK README. Must run before anything imports
// the powersync db module.
if (typeof (globalThis as any).Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
