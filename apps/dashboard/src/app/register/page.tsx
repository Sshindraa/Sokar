import { SignUp } from '@clerk/nextjs';

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SignUp
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
