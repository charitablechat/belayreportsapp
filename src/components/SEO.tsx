import { Helmet } from "react-helmet-async";

const SITE = "https://belayreportsapp.com";

interface SEOProps {
  title: string;
  description: string;
  path: string;
}

/**
 * Per-route head tags. Sets title, meta description, canonical, and
 * self-referencing og:* / twitter:* tags. Sitewide og:image and
 * Organization JSON-LD stay in index.html as the static fallback for
 * social-preview crawlers that don't execute JS.
 */
export function SEO({ title, description, path }: SEOProps) {
  const url = `${SITE}${path}`;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
    </Helmet>
  );
}

export default SEO;
