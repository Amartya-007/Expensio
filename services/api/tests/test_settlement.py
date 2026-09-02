from decimal import Decimal
import unittest

from app.settlement import Balance, Settlement, build_settlement_plan


class SettlementPlanTests(unittest.TestCase):
    def test_matches_largest_debtors_and_creditors_per_currency(self) -> None:
        balances = [
            Balance("alice", "Alice", "INR", Decimal("75.00")),
            Balance("bob", "Bob", "INR", Decimal("-50.00")),
            Balance("carol", "Carol", "INR", Decimal("-25.00")),
            Balance("alice", "Alice", "USD", Decimal("100.00")),
            Balance("bob", "Bob", "USD", Decimal("-100.00")),
        ]

        self.assertEqual(
            build_settlement_plan(balances),
            [
                Settlement("bob", "alice", Decimal("50.00"), "INR"),
                Settlement("carol", "alice", Decimal("25.00"), "INR"),
                Settlement("bob", "alice", Decimal("100.00"), "USD"),
            ],
        )

    def test_ignores_balances_within_one_minor_unit(self) -> None:
        self.assertEqual(
            build_settlement_plan(
                [
                    Balance("alice", "Alice", "INR", Decimal("0.004")),
                    Balance("bob", "Bob", "INR", Decimal("-0.004")),
                ]
            ),
            [],
        )

    def test_uses_stable_participant_order_for_equal_magnitudes(self) -> None:
        self.assertEqual(
            build_settlement_plan(
                [
                    Balance("creditor-b", "B", "INR", Decimal("50.00")),
                    Balance("creditor-a", "A", "INR", Decimal("50.00")),
                    Balance("debtor-b", "D-B", "INR", Decimal("-50.00")),
                    Balance("debtor-a", "D-A", "INR", Decimal("-50.00")),
                ]
            ),
            [
                Settlement("debtor-a", "creditor-a", Decimal("50.00"), "INR"),
                Settlement("debtor-b", "creditor-b", Decimal("50.00"), "INR"),
            ],
        )

    def test_does_not_net_different_currencies(self) -> None:
        plan = build_settlement_plan(
            [
                Balance("alice", "Alice", "INR", Decimal("10.00")),
                Balance("bob", "Bob", "USD", Decimal("-10.00")),
            ]
        )
        self.assertEqual(plan, [])

    def test_partial_match_carries_remainder_into_next_pair(self) -> None:
        """Every other test above resolves in clean 1:1 (or 2:1) matches, where both
        sides of a pairing zero out in the same step. This is the case where they don't:
        the larger debtor (70) only partly covers the larger creditor (60), leaving a
        remainder (10) that has to roll into a second match against the *next* creditor
        (40) — exercising the branch where only one of the two index advances happens
        per loop iteration, not both."""

        plan = build_settlement_plan(
            [
                Balance("creditor-1", "C1", "INR", Decimal("60.00")),
                Balance("creditor-2", "C2", "INR", Decimal("40.00")),
                Balance("debtor-1", "D1", "INR", Decimal("-70.00")),
                Balance("debtor-2", "D2", "INR", Decimal("-30.00")),
            ]
        )
        self.assertEqual(
            plan,
            [
                Settlement("debtor-1", "creditor-1", Decimal("60.00"), "INR"),
                Settlement("debtor-1", "creditor-2", Decimal("10.00"), "INR"),
                Settlement("debtor-2", "creditor-2", Decimal("30.00"), "INR"),
            ],
        )
        self.assertEqual(sum((s.amount for s in plan), Decimal("0")), Decimal("100.00"))


if __name__ == "__main__":
    unittest.main()
