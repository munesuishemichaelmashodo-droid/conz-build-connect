// Driver-side numbers for the offer form. These never set a price: the price is the
// driver's own offer, and quotes come only from compute_material_offer. This module
// mirrors the database's rules so the form and the database can't disagree:
//   - commission: commission_amount() = round(price × rate / 100, 2), first completed
//     job free (complete_job / hold_job_commission, migration 0091);
//   - trips: tg_stamp_bid_capacity = ceil(quantity / truck capacity).
// The fuel figure is an estimate with stated assumptions, not a cost guarantee.

/** Engine default (0118 setting fuel_l_per_100km); shown to drivers as an assumption. */
export const DEFAULT_FUEL_L_PER_100KM = 32;

function toCents(dollars: number): number | null {
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

/** Con Z fee in dollars, rounded like the database (half away from zero, to cents). */
export function commissionFee(
  price: number,
  ratePct: number,
  firstJobFree: boolean,
): number | null {
  const cents = toCents(price);
  if (cents === null || !Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) return null;
  if (firstJobFree) return 0;
  const basisPoints = Math.round(ratePct * 100); // 7% -> 700
  return Math.round((cents * basisPoints) / 10_000) / 100;
}

/** Trips needed for a load in a truck, or null if either number is unusable. */
export function tripsFor(quantityM3: number, capacityM3: number): number | null {
  if (!Number.isFinite(quantityM3) || quantityM3 <= 0) return null;
  if (!Number.isFinite(capacityM3) || capacityM3 <= 0) return null;
  return Math.ceil(quantityM3 / capacityM3);
}

export type FuelEstimate =
  | {
      available: true;
      km: number;
      litres: number;
      cost: number;
      assumptions: string[];
      excluded: string[];
    }
  | { available: false; reason: string };

/**
 * Fuel for the job: each trip drives pickup → site loaded and back empty. The drive to
 * the first pickup is unknown here and left out (said so in `excluded`).
 */
export function fuelEstimate(input: {
  routeKm: number | null | undefined;
  routeIsRoad: boolean;
  trips: number | null;
  litresPer100km: number | null | undefined;
  dieselPerLitre: number | null | undefined;
}): FuelEstimate {
  const { routeKm, trips } = input;
  if (routeKm == null || !Number.isFinite(routeKm) || routeKm <= 0) {
    return {
      available: false,
      reason: "The pickup point isn't known yet, so the route can't be measured.",
    };
  }
  if (trips == null || trips < 1)
    return { available: false, reason: "Choose a truck to work out the trips." };
  const diesel = input.dieselPerLitre;
  if (diesel == null || !Number.isFinite(diesel) || diesel <= 0 || diesel > 10) {
    return { available: false, reason: "No diesel price is set." };
  }
  const lPer100 =
    input.litresPer100km != null && input.litresPer100km > 0 && input.litresPer100km <= 100
      ? input.litresPer100km
      : DEFAULT_FUEL_L_PER_100KM;
  const km = Math.round(routeKm * 2 * trips * 10) / 10;
  const litres = Math.round(((km * lPer100) / 100) * 10) / 10;
  const cost = Math.round(litres * diesel * 100) / 100;
  return {
    available: true,
    km,
    litres,
    cost,
    assumptions: [
      `${trips} trip${trips === 1 ? "" : "s"}, there and back (${Math.round(routeKm)} km each way${input.routeIsRoad ? " by road" : ", straight line"})`,
      `${lPer100} L per 100 km`,
      `diesel $${diesel.toFixed(2)}/L`,
    ],
    excluded: [
      "the drive to the first pickup",
      "tolls, tyres, maintenance, loading fees and your time",
    ],
  };
}

/** What the driver keeps from an offer, before and after estimated fuel. */
export function earnings(price: number, fee: number | null, fuel: FuelEstimate | null) {
  if (!Number.isFinite(price) || price <= 0 || fee == null) return null;
  const afterFee = Math.round((price - fee) * 100) / 100;
  const afterFuel = fuel && fuel.available ? Math.round((afterFee - fuel.cost) * 100) / 100 : null;
  return { afterFee, afterFuel };
}
