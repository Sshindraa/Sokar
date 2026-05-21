import { SignIn } from '@clerk/nextjs';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SignIn
        appearance={{
          elements: {
            rootBox: 'mx-auto w-full max-w-sm',
            card: 'shadow-none border border-[var(--border)]',
          },
        }}
      />
    </div>
  );
}
