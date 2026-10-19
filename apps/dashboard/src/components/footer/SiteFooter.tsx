import Link from 'next/link';
import Image from 'next/image';
import { BRAND_SLOGAN, BRAND_TITLE } from '@sokar/shared';
import FooterGlow from './FooterGlow';

const COLUMNS = [
  {
    title: 'Menu',
    links: [
      { label: 'Démonstration', href: '#demo' },
      { label: 'Tarifs', href: '/pricing' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  { title: 'À propos', links: [{ label: 'Espace partenaire', href: '/login' }] },
  { title: 'Contact', links: [{ label: 'hello@sokar.tech', href: 'mailto:hello@sokar.tech' }] },
];

const LINK =
  'flex min-h-[44px] w-fit items-center text-sm text-white/60 transition-all duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 font-sans';

export default function SiteFooter() {
  return (
    <footer className="relative z-10 flex w-full flex-col items-center overflow-hidden border-t border-white/5 bg-black px-6 pt-16">
      <div className="flex w-full max-w-6xl flex-col gap-12 lg:flex-row lg:justify-between">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <Link href="/" className="flex w-fit shrink-0 items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white">
              <Image src="/logo-nav.png" alt="" width={24} height={24} className="h-6 w-6 invert" />
            </span>
            <span className="text-3xl font-medium text-white font-display">Sokar</span>
          </Link>
          <span aria-hidden="true" className="hidden h-8 w-px bg-white/15 sm:block" />
          <p className="max-w-xs text-sm leading-relaxed text-white/60 font-sans">
            {BRAND_TITLE}. {BRAND_SLOGAN}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 sm:gap-x-16">
          {COLUMNS.map((column) => (
            <nav
              key={column.title}
              aria-label={column.title}
              className="flex flex-col gap-1 sm:gap-5"
            >
              <h4 className="mb-2 text-base font-semibold text-white font-sans sm:mb-0">
                {column.title}
              </h4>
              {column.links.map((link) =>
                link.href.startsWith('/') ? (
                  <Link key={link.label} href={link.href} className={LINK}>
                    {link.label}
                  </Link>
                ) : (
                  <a key={link.label} href={link.href} className={LINK}>
                    {link.label}
                  </a>
                ),
              )}
            </nav>
          ))}
        </div>
      </div>

      <div className="mt-16 flex w-full max-w-6xl flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/50 font-sans sm:flex-row">
        <p>Copyright &copy; {new Date().getFullYear()} Sokar. Tous droits réservés.</p>
        <div className="flex items-center gap-6">
          <Link href="/privacy" className="transition-all duration-200 hover:text-white">
            Confidentialité
          </Link>
          <Link href="/legal" className="transition-all duration-200 hover:text-white">
            Mentions légales
          </Link>
        </div>
      </div>

      <FooterGlow />
    </footer>
  );
}
