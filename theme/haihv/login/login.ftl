<#import "template.ftl" as layout>
<#import "components/atoms/button.ftl" as button>
<#import "components/atoms/button-group.ftl" as buttonGroup>
<#import "components/atoms/checkbox.ftl" as checkbox>
<#import "components/atoms/form.ftl" as form>
<#import "components/atoms/input.ftl" as input>
<#import "components/atoms/link.ftl" as link>
<#import "components/molecules/identity-provider.ftl" as identityProvider>
<#import "features/labels/username.ftl" as usernameLabel>

<#-- Macro to render a single provider button -->
<#macro renderProviderButton p useFullName=false>
  <#-- Attempt to import the provider icon dynamically -->
  <#attempt>
    <#assign provider_icon_path = "assets/providers/" + p.alias + ".ftl">
    <#import provider_icon_path as providerIcon>
  <#recover>
    <#-- Fallback if the specific provider icon doesn't exist -->
    <#assign providerIcon = "">
  </#attempt>

  <a
    href="${p.loginUrl}"
    class="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 <#if useFullName>w-full</#if>"
    id="social-${p.alias}"
    type="button"
  >
    <#if providerIcon?has_content>
      <span class="h-5 w-5" aria-hidden="true">
        <@providerIcon.kw name=p.displayName />
      </span>
      <span class="ml-2">${p.displayName!}</span> <#-- Display name next to icon -->
    <#else>
      <#-- Fallback if icon FTL couldn't be loaded -->
      <#if p.iconClasses?has_content>
        <i class="${properties.kcSocialButtonIconClass!} ${p.iconClasses!}" aria-hidden="true"></i>
        <span class="sr-only">${p.displayName!}</span>
      <#else>
        <span class="">${p.displayName!}</span>
      </#if>
    </#if>
  </a>
</#macro>

<#assign usernameLabel><@usernameLabel.kw /></#assign>
<@layout.registrationLayout
  displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??
  displayMessage=!messagesPerField.existsError("username", "password")
  ;
  section
>
  <#if section="header">
    <div class="flex items-center justify-center">
      <span class="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary-700 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-300">
        ${msg("loginAccountTitle")}
      </span>
    </div>
  <#elseif section="form">
    <#if realm.password>
      <@form.kw
        action=url.loginAction
        method="post"
        onsubmit="login.disabled = true; return true;"
      >
        <input
          name="credentialId"
          type="hidden"
          value="<#if auth.selectedCredential?has_content>${auth.selectedCredential}</#if>"
        >
        <@input.kw
          autocomplete=realm.loginWithEmailAllowed?string("email", "username")
          autofocus=true
          disabled=usernameEditDisabled??
          invalid=messagesPerField.existsError("username", "password")
          label=usernameLabel
          message=kcSanitize(messagesPerField.getFirstError("username", "password"))
          name="username"
          type="text"
          value=(login.username)!''
        />
        <@input.kw
          invalid=messagesPerField.existsError("username", "password")
          label=msg("password")
          name="password"
          type="password"
        />
        <#if realm.rememberMe && !usernameEditDisabled?? || realm.resetPasswordAllowed>
          <div class="flex items-center justify-between gap-3 pt-1">
            <#if realm.rememberMe && !usernameEditDisabled??>
              <@checkbox.kw
                checked=login.rememberMe??
                label=msg("rememberMe")
                name="rememberMe"
              />
            </#if>
            <#if realm.resetPasswordAllowed>
              <@link.kw color="primary" href=url.loginResetCredentialsUrl size="small">
                ${msg("doForgotPassword")}
              </@link.kw>
            </#if>
          </div>
        </#if>
        <@buttonGroup.kw>
          <@button.kw color="primary" name="login" type="submit">
            ${msg("doLogIn")}
          </@button.kw>
        </@buttonGroup.kw>
      </@form.kw>
    </#if>
  <#elseif section="info">
    <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
      <div class="text-center text-sm text-slate-600 dark:text-slate-300">
        ${msg("noAccount")}
        <@link.kw color="primary" href=url.registrationUrl>
          ${msg("doRegister")}
        </@link.kw>
      </div>
    </#if>
  <#elseif section="socialProviders">
      <#if social.providers?? && social.providers?has_content>
        <div class="mt-6">
          <div class="relative">
            <div class="absolute inset-0 flex items-center" aria-hidden="true">
              <div class="w-full border-t border-slate-200 dark:border-slate-700"></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="bg-white px-2 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                ${msg("identity-provider-login-label")}
              </span>
            </div>
          </div>
        </div>

        <div class="mt-6 flex flex-col items-center gap-3">
          <#list social.providers as p>
            <div class="w-full max-w-xs">
              <@renderProviderButton p=p useFullName=true />
            </div>
          </#list>
        </div>
      </#if>
  </#if>
</@layout.registrationLayout>