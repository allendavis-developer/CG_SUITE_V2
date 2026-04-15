import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TinyModal from '@/components/ui/TinyModal';
import useAppStore from '@/store/useAppStore';
import { closeWebEposUploadFromApp } from '@/services/extensionClient';
import {
  WEB_EPOS_PRODUCTS_URL,
  WEB_EPOS_REOPEN_URL_KEY,
} from '@/pages/buyer/webEposUploadConstants';

function pathIsUploadWorkspace(pathname) {
  return (
    pathname === '/upload' ||
    pathname === '/upload-negotiation' ||
    pathname.startsWith('/upload/')
  );
}

/**
 * - Closes the extension’s Web EPOS worker when the SPA leaves upload routes or the app tab unloads (extension handles unload).
 * - When the worker window is closed by the user, resets upload workspace state, navigates home, and shows a reopen modal.
 */
export default function WebEposUploadLifecycle() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  const webEposWorkerClosedPrompt = useAppStore((s) => s.webEposWorkerClosedPrompt);
  const setWebEposWorkerClosedPrompt = useAppStore((s) => s.setWebEposWorkerClosedPrompt);

  useEffect(() => {
    const onMsg = (e) => {
      if (e.source !== window || e.data?.type !== 'WEB_EPOS_UPLOAD_WORKER_CLOSED') return;
      const lastUrl =
        typeof e.data.lastUrl === 'string' && e.data.lastUrl.trim()
          ? e.data.lastUrl.trim()
          : WEB_EPOS_PRODUCTS_URL;
      setWebEposWorkerClosedPrompt({ lastUrl });
      useAppStore.getState().resetRepricingWorkspace({
        homePath: '/upload',
        negotiationPath: '/upload-negotiation',
      });
      const p = pathnameRef.current;
      if (pathIsUploadWorkspace(p)) {
        navigate('/', { replace: true });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [navigate, setWebEposWorkerClosedPrompt]);

  useEffect(() => {
    const p = location.pathname;
    if (!pathIsUploadWorkspace(p)) {
      closeWebEposUploadFromApp().catch(() => {});
    }
  }, [location.pathname]);

  const onReopenWebEpos = () => {
    const lastUrl = webEposWorkerClosedPrompt?.lastUrl || WEB_EPOS_PRODUCTS_URL;
    setWebEposWorkerClosedPrompt(null);
    try {
      sessionStorage.setItem(WEB_EPOS_REOPEN_URL_KEY, lastUrl);
    } catch (_) {}
    useAppStore.getState().resetRepricingWorkspace({
      homePath: '/upload',
      negotiationPath: '/upload-negotiation',
    });
    navigate('/upload', { replace: true });
  };

  if (!webEposWorkerClosedPrompt) return null;

  return (
    <TinyModal
      title="Web EPOS window closed"
      onClose={() => setWebEposWorkerClosedPrompt(null)}
      closeOnBackdrop={false}
    >
      <p className="text-sm text-slate-600 mb-4">
        The minimised Web EPOS window for Upload was closed. Your upload session has been reset.
        Reopen Web EPOS at the same page you had open, then continue in the Upload module.
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="w-full py-3 rounded-xl font-bold uppercase tracking-tight text-sm"
          style={{ background: 'var(--brand-orange)', color: 'var(--brand-blue)' }}
          onClick={onReopenWebEpos}
        >
          Reopen Web EPOS
        </button>
        <button
          type="button"
          className="w-full py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
          onClick={() => setWebEposWorkerClosedPrompt(null)}
        >
          Dismiss
        </button>
      </div>
    </TinyModal>
  );
}
