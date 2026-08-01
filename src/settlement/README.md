# Settlement engine

The Settlement module reads only `normalized_transactions`. It must not import
or query marketplace-specific collections.

Marketplace importers are responsible for mapping source rows to
`NormalizedTransaction` and calling `SettlementService.replaceNormalizedScope`.
Adding a marketplace must not require a Settlement module change.

## Calculation contract

- `calculationRole: sale` contributes to gross sales using the absolute amount.
- `calculationRole: return` contributes to returns using the absolute amount.
- `calculationRole: expense` contributes to expenses and the dynamic category
  breakdown using the absolute amount.
- `calculationRole: adjustment` adjusts receivable using its signed amount.
- `contributesToReceived: true` contributes its signed amount to received.
- `disputed: true` makes the order settlement disputed.

`transactionCategory` and `transactionName` are open strings. New categories
therefore appear in settlement breakdowns and dynamic UI columns without an
engine deployment.
