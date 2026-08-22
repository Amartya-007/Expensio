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


if __name__ == "__main__":
    unittest.main()
