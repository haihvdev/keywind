<#import "/assets/providers/providers.ftl" as providerIcons>

<#macro kw providers=[]>
  <div class="separate pt-4 text-sm text-slate-500 dark:text-slate-400">
    ${msg("identity-provider-login-label")}
  </div>
  <div class="grid grid-cols-3 gap-3">
    <#list providers as provider>
      <#switch provider.alias>
        <#case "apple">
          <#assign colorClass="hover:bg-provider-apple/10 dark:hover:bg-provider-apple/20">
          <#break>
        <#case "bitbucket">
          <#assign colorClass="hover:bg-provider-bitbucket/10 dark:hover:bg-provider-bitbucket/20">
          <#break>
        <#case "discord">
          <#assign colorClass="hover:bg-provider-discord/10 dark:hover:bg-provider-discord/20">
          <#break>
        <#case "facebook">
          <#assign colorClass="hover:bg-provider-facebook/10 dark:hover:bg-provider-facebook/20">
          <#break>
        <#case "github">
          <#assign colorClass="hover:bg-provider-github/10 dark:hover:bg-provider-github/20">
          <#break>
        <#case "gitlab">
          <#assign colorClass="hover:bg-provider-gitlab/10 dark:hover:bg-provider-gitlab/20">
          <#break>
        <#case "google">
          <#assign colorClass="hover:bg-provider-google/10 dark:hover:bg-provider-google/20">
          <#break>
        <#case "instagram">
          <#assign colorClass="hover:bg-provider-instagram/10 dark:hover:bg-provider-instagram/20">
          <#break>
        <#case "linkedin-openid-connect">
          <#assign colorClass="hover:bg-provider-linkedin/10 dark:hover:bg-provider-linkedin/20">
          <#break>
        <#case "microsoft">
          <#assign colorClass="hover:bg-provider-microsoft/10 dark:hover:bg-provider-microsoft/20">
          <#break>
        <#case "oidc">
          <#assign colorClass="hover:bg-provider-oidc/10 dark:hover:bg-provider-oidc/20">
          <#break>
        <#case "openshift-v3">
          <#assign colorClass="hover:bg-provider-openshift/10 dark:hover:bg-provider-openshift/20">
          <#break>
        <#case "openshift-v4">
          <#assign colorClass="hover:bg-provider-openshift/10 dark:hover:bg-provider-openshift/20">
          <#break>
        <#case "paypal">
          <#assign colorClass="hover:bg-provider-paypal/10 dark:hover:bg-provider-paypal/20">
          <#break>
        <#case "slack">
          <#assign colorClass="hover:bg-provider-slack/10 dark:hover:bg-provider-slack/20">
          <#break>
        <#case "stackoverflow">
          <#assign colorClass="hover:bg-provider-stackoverflow/10 dark:hover:bg-provider-stackoverflow/20">
          <#break>
        <#case "twitter">
          <#assign colorClass="hover:bg-provider-twitter/10 dark:hover:bg-provider-twitter/20">
          <#break>
        <#default>
          <#assign colorClass="hover:bg-slate-100 dark:hover:bg-slate-800">
      </#switch>

      <a
        class="${colorClass} flex justify-center rounded-xl border border-slate-200 bg-white/80 py-2.5 transition-colors hover:border-transparent dark:border-slate-700 dark:bg-slate-900/80"
        data-provider="${provider.alias}"
        href="${provider.loginUrl}"
        type="button"
      >
        <#if providerIcons[provider.alias]??>
          <div class="h-6 w-6">
            <@providerIcons[provider.alias] />
          </div>
        <#else>
          ${provider.displayName!}
        </#if>
      </a>
    </#list>
  </div>
</#macro>
