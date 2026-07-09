'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  buttonStyle?: 'standalone' | 'flat';
}

export default function MobileNav({ buttonStyle = 'standalone' }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const links = [
    { label: 'Services', href: '/#services' },
    { label: "Cas d'usage", href: '/#demo' },
    { label: 'Tarifs', href: '/pricing' },
    { label: "S'inscrire", href: '/register' },
  ];

  return (
    <>
      {/* Hamburger button — visible only on mobile */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex md:hidden items-center justify-center transition-all duration-200 active:scale-95',
          buttonStyle === 'standalone'
            ? 'h-11 w-11 rounded-full border border-white/10 bg-black/40 text-white/70 backdrop-blur-xl hover:text-white hover:border-white/20'
            : 'h-9 w-9 rounded-full text-white/70 hover:text-white hover:bg-white/5',
        )}
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile drawer */}
      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[100] md:hidden">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            {/* Panel */}
            <nav className="absolute right-0 top-0 h-full w-72 bg-background border-l border-white/10 p-6 pt-24 flex flex-col gap-2 shadow-2xl animate-in slide-in-from-right duration-300">
              {links.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-4 py-3 text-base font-medium text-white/70 transition-all duration-200 hover:bg-white/5 hover:text-white min-h-[48px] flex items-center"
                >
                  {item.label}
                </Link>
              ))}
              <hr className="my-2 border-white/10" />
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition-all duration-200 hover:bg-white/90 active:scale-[0.98] min-h-[48px]"
              >
                Dashboard
                <ArrowUpRight size={16} />
              </Link>
            </nav>
          </div>,
          document.body,
        )}
    </>
  );
}
