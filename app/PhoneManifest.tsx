'use client';

import { useEffect } from 'react';

// The web-app manifest is what lets Chrome install the dashboard as an app with its own icon. That is wanted on a phone's
// home screen but not on the PC, so the link is only added on touch-first devices; without it a desktop browser does not
// offer to install the site.
export default function PhoneManifest() {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches || document.querySelector('link[rel="manifest"]')) return;
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);
  }, []);
  return null;
}
