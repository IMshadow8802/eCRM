import UiPageHeader from "./ui/PageHeader";

/**
 * Legacy PageHeader — thin proxy to the design-system PageHeader so Master
 * pages migrate without call-site changes. New code should import from
 * `components/ui/PageHeader` directly.
 */
const PageHeader = ({ title, subtitle, actions, icon, breadcrumb, tabs, ...rest }) => (
  <UiPageHeader
    title={title}
    subtitle={subtitle}
    actions={actions}
    icon={icon}
    breadcrumb={breadcrumb}
    tabs={tabs}
    {...rest}
  />
);

export default PageHeader;
