import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import config from './config/config'
import './config/e2e-hooks'
import './index.scss'
import 'toastr/build/toastr.min.css';
import { BrowserRouter } from 'react-router-dom';

// The tab title comes from the config rather than index.html, so there is one
// place to change it. index.html still carries it for the moment before this runs.
document.title = config.appTitle;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
