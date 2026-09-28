import "./globals.css";

export const metadata = {
  title: "Kargo Hiring",
  description: "Internal CV scoring and outreach dashboard",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
