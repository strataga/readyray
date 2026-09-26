import type { Metadata } from 'next';
import './reviewer.css';

export const metadata: Metadata = {
  title: 'ArchGauge — Evidence review workspace',
  description: 'A calm, evidence-first workspace for reviewing architecture and release readiness.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
