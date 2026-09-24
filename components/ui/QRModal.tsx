'use client';

import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useTranslations } from 'next-intl';
import Modal from './Modal';

interface QRModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  title?: string;
}

export default function QRModal({ isOpen, onClose, url, title }: QRModalProps) {
  const t = useTranslations('common');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 240, margin: 2 });
  }, [isOpen, url]);

  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'player-profile-qr.png';
    a.click();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title ?? t('share_via_qr')}>
      <div className="flex flex-col items-center gap-4">
        <canvas ref={canvasRef} className="rounded-lg" />
        <p className="text-xs text-gray-500 dark:text-gray-400 break-all text-center">
          {url}
        </p>
        <button
          onClick={handleDownload}
          className="w-full bg-brand-green text-black font-semibold py-2 rounded-lg hover:opacity-90 transition text-sm"
        >
          Download QR
        </button>
      </div>
    </Modal>
  );
}
