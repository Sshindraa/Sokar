'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { SignedIn, SignedOut } from '@clerk/nextjs';
import { ArrowUpRight } from 'lucide-react';

export default function MobileNav() {
  const [open, setOpen] = useState(false);

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
    { label: 'Services', href: '#services' },
    { label: "Cas d'usage", href: '#cases' },
    { label: 'Tarifs', href: '/pricing' },
    { label: 'Contact', href: '#contact' },
  ];

  return (
    <>
      {/* Hamburger button — visible only on mobile */}
      <button
        onClick={() => setOpen(!open)}
        className="flex md:hidden items-center justify-center h-11 w-11 rounded-full border border-white/10 bg-black/40 text-white/70 backdrop-blur-xl transition-all duration-200 hover:text-white hover:border-white/20 active:scale-95"
        aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <nav className="absolute right-0 top-0 h-full w-72 bg-[#0a0a0a] border-l border-white/10 p-6 pt-24 flex flex-col gap-2 shadow-2xl animate-in slide-in-from-right duration-300">
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
            <SignedOut>
              <Link
                href="/register"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition-all duration-200 hover:bg-white/90 active:scale-[0.98] min-h-[48px]"
              >
                Essai gratuit
                <ArrowUpRight size={16} />
              </Link>
            </SignedOut>
            <SignedIn>
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition-all duration-200 hover:bg-white/90 active:scale-[0.98] min-h-[48px]"
              >
                Dashboard
                <ArrowUpRight size={16} />
              </Link>
            </SignedIn>
          </nav>
        </div>
      )}
    </>
  );
}
