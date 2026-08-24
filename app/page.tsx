"use client";

import dynamic from "next/dynamic";

// The whole app is stateful and reads its project from localStorage, so it
// has nothing meaningful to server-render — loading it client-only avoids
// a hydration mismatch between the server's empty default and whatever the
// browser has saved.
const App = dynamic(() => import("@/components/App"), { ssr: false });

export default function Home() {
  return <App />;
}
