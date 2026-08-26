import { differenceInDays, isToday, isYesterday, parseISO, startOfDay } from 'date-fns';

export type TripBudgetInput = {
  totalBudget: number | null;
  startDate: string | null;
  endDate: string | null;
  peopleCount: number;
  expenses: Array<{ amount: number; date: string }>;
};

export type TripStats = ReturnType<typeof calculateStats>;

// Ported from tripspend/src/utils/calculations.ts's calculateStats -- the actual
// burn-rate/days-remaining/overspend math behind Dashboard.tsx, kept byte-for-byte
// identical in formula even though the surrounding types changed. See
// docs/architecture/expensio-ui-port-plan.md's "The budget concept" section for the
// history of why this didn't exist here before.
//
// What's different from the original, and why:
// - Takes plain totalBudget/startDate/endDate/peopleCount/expenses instead of a
//   TripSetup+TripData pair -- Expensio has no memberRegistry/legacy-migration concept
//   to thread through, and peopleCount is a live count of participants (who can be
//   added/removed after creation) rather than a fixed field set once at setup.
// - Returns null when totalBudget/startDate/endDate is missing, same as the original
//   returned null for `!setup`. A trip with no budget set has nothing to compute; the
//   caller decides what to show instead (TripSpend always had a setup, since its
//   creation flow required a budget -- Expensio's doesn't, deliberately, since budget is
//   optional here).
// - `expense.date` here is each expense's `expense_date` already coalesced to
//   `created_at`'s date by the caller if null (expense_date is nullable on this side;
//   TripSpend's data model required a date on every expense, this one doesn't) -- this
//   function itself doesn't know or care about that fallback, it just takes a date string.
export function calculateStats(input: TripBudgetInput) {
  const { totalBudget, startDate, endDate, peopleCount, expenses } = input;
  if (totalBudget == null || !startDate || !endDate) return null;

  let totalSpent = 0;
  let todaySpent = 0;
  let yesterdaySpent = 0;

  for (const exp of expenses) {
    totalSpent += exp.amount;
    const expenseDate = parseISO(exp.date);
    if (isToday(expenseDate)) todaySpent += exp.amount;
    else if (isYesterday(expenseDate)) yesterdaySpent += exp.amount;
  }

  const remainingBalance = totalBudget - totalSpent;
  const perPersonSpend = peopleCount > 0 ? totalSpent / peopleCount : 0;
  const remainingPercentage = (remainingBalance / totalBudget) * 100;

  const today = startOfDay(new Date());
  const tripStart = startOfDay(parseISO(startDate));
  const tripEnd = startOfDay(parseISO(endDate));
  const totalDays = Math.max(1, differenceInDays(tripEnd, tripStart) + 1);

  const hasStarted = today >= tripStart;
  const hasEnded = today > tripEnd;

  const daysPassed = hasStarted ? Math.max(1, differenceInDays(today, tripStart) + 1) : 0;
  const daysRemaining = hasEnded ? 0 : hasStarted ? Math.max(0, differenceInDays(tripEnd, today)) : totalDays;

  const dailyBurnRate = daysPassed > 0 ? totalSpent / daysPassed : 0;
  const remainingPerDay = daysRemaining > 0 ? remainingBalance / daysRemaining : remainingBalance;
  const budgetLastsDays = dailyBurnRate > 0 ? remainingBalance / dailyBurnRate : Infinity;
  const projectedEndBalance = hasStarted ? remainingBalance - dailyBurnRate * daysRemaining : remainingBalance;
  const projectedDeficit = projectedEndBalance < 0 ? Math.abs(projectedEndBalance) : 0;
  const isOverspending =
    remainingBalance < 0 || (hasStarted && daysRemaining > 0 && dailyBurnRate > remainingPerDay);

  // Tailwind class names in the original (text-green-500/bg-green-50/border-green-200
  // etc.) don't apply here -- NativeWind className strings work for RN too, so these are
  // kept as literal class fragments rather than translated to hex, same device used
  // throughout the rest of this port (see global.css's header comment).
  let statusColor = 'text-green-600';
  let bgColor = 'bg-green-50';
  let borderColor = 'border-green-200';

  if (remainingPercentage < 20) {
    statusColor = 'text-red-600';
    bgColor = 'bg-red-50';
    borderColor = 'border-red-200';
  } else if (remainingPercentage <= 50) {
    statusColor = 'text-orange-600';
    bgColor = 'bg-orange-50';
    borderColor = 'border-orange-200';
  }

  return {
    totalSpent,
    remainingBalance,
    perPersonSpend,
    remainingPercentage,
    todaySpent,
    yesterdaySpent,
    dailyBurnRate,
    remainingPerDay,
    budgetLastsDays,
    projectedEndBalance,
    projectedDeficit,
    isOverspending,
    totalDays,
    daysRemaining,
    statusColor,
    bgColor,
    borderColor,
  };
}
