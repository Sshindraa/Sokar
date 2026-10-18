'use client';

import { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AccountMenu } from '@/components/AccountMenu';
import { useDashboardTheme } from '@/features/theme/dashboard-theme';
import { SyncOrganization } from '@/app/dashboard/SyncOrganization';
import { useApi } from '@/lib/api';
import { SiteProvider, SiteSwitcher } from '@/features/sites/site-context';
import { DashboardThemeProvider } from '@/features/theme/dashboard-theme';
import { OnboardingAccessBoundary } from '@/features/onboarding/onboarding-access-boundary';
import { OnboardingProvider } from '@/features/onboarding/onboarding-provider';
import { OnboardingWizard } from '@/features/onboarding/onboarding-wizard';

function OnboardingThemeToggle() {
  const { theme, toggleTheme } = useDashboardTheme();
  return (
    <Button
      variant="ghost"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
      className="h-10 justify-start rounded-full px-3 text-muted-foreground transition-all duration-200 hover:text-foreground"
    >
      {theme === 'dark' ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
      {theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
    </Button>
  );
}

const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function OnboardingSiteBoundary({ children }: { children: ReactNode }) {
  const { organizationId } = useApi();
  return <SiteProvider organizationId={organizationId}>{children}</SiteProvider>;
}

function OnboardingPageContent() {
  return (
    <OnboardingSiteBoundary>
      {hasClerkKey && <SyncOrganization />}
      <OnboardingAccessBoundary
        controls={
          <div className="flex items-center gap-3">
            <SiteSwitcher />
            <AccountMenu />
          </div>
        }
        onboarding={<OnboardingWizard footerControls={<OnboardingThemeToggle />} />}
      >
        {null}
      </OnboardingAccessBoundary>
    </OnboardingSiteBoundary>
  );
}

export default function OnboardingPage() {
  return (
    <OnboardingProvider>
      <DashboardThemeProvider>
        <OnboardingPageContent />
      </DashboardThemeProvider>
    </OnboardingProvider>
  );
}
