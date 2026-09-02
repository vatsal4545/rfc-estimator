"use client";

import { CarbonSection, DealSection, FinancingSection, ModelUnavailable, RevenueSection, TariffSection, UsageSection, useModel } from "../BusinessModelTab";
import { CommercialTab } from "../CommercialTab";

// The intake-shaped tabs 5–8 compose the model's sections in the sheet's
// order: the Commercial tab carries the financing terms, Revenue the site,
// tariff and projection, Carbon the credit, Deal structure the knobs.

export function CommercialIntakeTab() {
  return (
    <div>
      <CommercialTab />
      <FinancingSection />
    </div>
  );
}

export function RevenueIntakeTab() {
  const x = useModel();
  if (!x) return <ModelUnavailable />;
  return (
    <div>
      <UsageSection />
      <TariffSection />
      <RevenueSection />
    </div>
  );
}

export function CarbonIntakeTab() {
  const x = useModel();
  if (!x) return <ModelUnavailable />;
  return <CarbonSection />;
}

export function DealIntakeTab() {
  const x = useModel();
  if (!x) return <ModelUnavailable />;
  return <DealSection />;
}
