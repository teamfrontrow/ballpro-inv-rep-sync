# BallPro Shopify Theme

Independent theme deployment containing the storefront inventory-by-date accordion. The integration reads `product.metafields.custom.inventory_by_date`; it does not call RepSpark or the connector at request time.

## Changed integration surface

- `snippets/product-inventory-table.liquid`
- `snippets/product-information-blocks.liquid`
- `snippets/product-information-below-media.liquid`
- `sections/main-product.liquid`
- `assets/section-main-product.css`
- `templates/product.json`

## Deployment

Authenticate Shopify CLI, then preview this directory against the development store before pushing it:

```sh
shopify theme dev --store ballproplusdev.myshopify.com --path .
shopify theme check --path .
```

Publish through the existing BallPro theme workflow only after verifying a synced product with current and future inventory, capped values, and a product with no inventory metafield. Keep the existing live theme as the rollback artifact.

The source snapshot copied for this deployment came from `teamfrontrow/2026_BallPro_Theme` at commit `72e48e...`.
