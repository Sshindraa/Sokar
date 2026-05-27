import { SignIn } from '@clerk/nextjs';

export default function LoginPage() {
  return (
    <div className="sokar-page flex min-h-screen items-center justify-center px-4 pt-20">
      <SignIn
        appearance={{
          elements: {
            rootBox: 'mx-auto w-full max-w-sm',
            card: 'shadow-none border border-border bg-card text-foreground',
          },
        }}
      />
    </div>
  );
}
