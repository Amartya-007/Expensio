from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_serializer


class SettlementSuggestion(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    from_participant: str
    to_participant: str
    amount: Decimal = Field(gt=Decimal("0"), decimal_places=2)
    currency: str

    @field_serializer("amount")
    def serialize_amount(self, value: Decimal) -> str:
        """Keep money exact at the JSON boundary."""

        return f"{value:.2f}"


class SettlementPlanResponse(BaseModel):
    trip_id: str
    suggestions: list[SettlementSuggestion]
