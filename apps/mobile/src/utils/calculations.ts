import { differenceInDays, isToday, isYesterday, parseISO, startOfDay } from 'date-fns';

export type TripBudgetInput = {
  totalBudget: number | null;
  startDate: string | null;
  endDate: string | null;
  peopleCount: number;
  expenses: Array<{ amount: number; date: string }>;
};

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
  const daysRemaining = hasEnded
    ? 0
    : hasStarted
    ? Math.max(0, differenceInDays(tripEnd, today))
    : totalDays;

  const dailyBurnRate = daysPassed > 0 ? totalSpent / daysPassed : 0;
  const remainingPerDay =
    daysRemaining > 0 ? remainingBalance / daysRemaining : remainingBalance;
  const budgetLastsDays =
    dailyBurnRate > 0 ? remainingBalance / dailyBurnRate : Infinity;
  const projectedEndBalance = hasStarted
    ? remainingBalance - dailyBurnRate * daysRemaining
    : remainingBalance;
  const projectedDeficit = projectedEndBalance < 0 ? Math.abs(projectedEndBalance) : 0;
  const isOverspending =
    remainingBalance < 0 ||
    (hasStarted && daysRemaining > 0 && dailyBurnRate > remainingPerDay);

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
  };
}
