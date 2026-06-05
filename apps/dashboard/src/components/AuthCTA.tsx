"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { ArrowUpRight } from "lucide-react";

interface AuthCTAProps {
  variant?: "nav" | "hero";
}

const navClasses =
  "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-black hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]";

const heroClasses =
  "inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-white/90 hover:shadow-[0_0_20px_rgba(255,255,255,0.12)] active:scale-[0.98] w-full sm:w-auto";

export default function AuthCTA({ variant = "nav" }: AuthCTAProps) {
  const isNav = variant === "nav";
  const className = isNav ? navClasses : heroClasses;

  return (
    <>
      <SignedOut>
        <Link href="/register" className={className}>
          {isNav ? (
            <>
              Essai gratuit
              <ArrowUpRight size={14} />
            </>
          ) : (
            "Réserver une démo"
          )}
        </Link>
      </SignedOut>
      <SignedIn>
        <Link href="/dashboard" className={className}>
          {isNav ? (
            <>
              Dashboard
              <ArrowUpRight size={14} />
            </>
          ) : (
            "Accéder au Dashboard"
          )}
        </Link>
      </SignedIn>
    </>
  );
}
