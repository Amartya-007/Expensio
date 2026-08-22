from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable


MINOR_UNIT = Decimal("0.01")


@dataclass(frozen=True)
class Balance:
    participant_id: str
    display_name: str
    currency: str
    balance: Decimal


@dataclass(frozen=True)
class Settlement:
    from_participant: str
    to_participant: str
    amount: Decimal
    currency: str


def _money(value: Decimal) -> Decimal:
    return value.quantize(MINOR_UNIT, rounding=ROUND_HALF_UP)


def build_settlement_plan(balances: Iterable[Balance]) -> list[Settlement]:
    """Return deterministic, read-only settlement suggestions per currency.

    Positive balances are creditors and negative balances are debtors. Matching is
    largest-magnitude debtor to largest creditor. Balances smaller than one minor unit
    are ignored, and currencies are never mixed.
    """

    grouped: dict[str, dict[str, Decimal]] = {}
    for balance in balances:
        currency = balance.currency.upper()
        grouped.setdefault(currency, {})[balance.participant_id] = _money(
            grouped.setdefault(currency, {}).get(balance.participant_id, Decimal("0"))
            + balance.balance
        )

    suggestions: list[Settlement] = []
    for currency in sorted(grouped):
        creditors = [
            [participant_id, amount]
            for participant_id, amount in grouped[currency].items()
            if amount >= MINOR_UNIT
        ]
        debtors = [
            [participant_id, -amount]
            for participant_id, amount in grouped[currency].items()
            if amount <= -MINOR_UNIT
        ]
        creditors.sort(key=lambda item: (-item[1], item[0]))
        debtors.sort(key=lambda item: (-item[1], item[0]))

        creditor_index = 0
        debtor_index = 0
        while creditor_index < len(creditors) and debtor_index < len(debtors):
            debtor_id, debtor_amount = debtors[debtor_index]
            creditor_id, creditor_amount = creditors[creditor_index]
            amount = _money(min(debtor_amount, creditor_amount))
            if amount < MINOR_UNIT:
                break

            suggestions.append(Settlement(debtor_id, creditor_id, amount, currency))
            debtors[debtor_index][1] = _money(debtor_amount - amount)
            creditors[creditor_index][1] = _money(creditor_amount - amount)

            if debtors[debtor_index][1] < MINOR_UNIT:
                debtor_index += 1
            if creditors[creditor_index][1] < MINOR_UNIT:
                creditor_index += 1

    return suggestions
