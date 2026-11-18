'use client';

import { Home } from '@/features/party/party-console';
import { useState } from 'react';
import { clearWhenUp } from '@/lib/dashboard-recovery';

export default function Page() {
  const [onUp] = useState(() => clearWhenUp(() => sessionStorage));
  return <Home onUp={onUp} />;
}
