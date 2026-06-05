"use client";

import Link from "next/link";
import { SignedIn, SignedOut, useAuth } from "@clerk/nextjs";
import { ArrowUpRight } from "lucide-react";

interface AuthCTAProps {
  variant?: "nav" | "hero";
}

const navClasses =
  "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:text-black hover:shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]";

const heroClasses =
  "inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.01] hover:bg-white/90 hover:shadow-[0_0_20px_rgba(255,255,255,0.12)] active:scale-[0.98] w-full sm:w-auto";

function LoadingPlaceholder({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span
      className={`${className} pointer-events-none`}
      aria-hidden="true"
      style={{ opacity: 0 }}
    >
      {label}
    </span>
  );
}

export default function AuthCTA({ variant = "nav" }: AuthCTAProps) {
  const { isLoaded } = useAuth();
  const isNav = variant === "nav";
  const className = isNav ? navClasses : heroClasses;

  if (!isLoaded) {
    return (
      <LoadingPlaceholder
        className={className}
        label={isNav ? "Essai gratuit" : "Réserver une démo"}
      />
    );
  }

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
