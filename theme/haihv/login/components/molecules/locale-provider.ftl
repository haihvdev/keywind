<#import "/assets/icons/chevron-down.ftl" as icon>
<#import "/components/atoms/link.ftl" as link>

<#macro kw currentLocale="" locales=[]>
  <div class="relative" x-data="{ open: false }">
    <@link.kw @click="open = true" color="secondary" component="button" type="button">
      <div class="flex items-center">
        <span class="mr-1 text-sm">${currentLocale}</span>
        <@icon.kw />
      </div>
    </@link.kw>
    <div
      @click.away="open = false"
      class="absolute bottom-0 -left-4 mb-6 max-h-80 overflow-y-scroll rounded-xl border border-slate-200 bg-white/95 shadow-xl shadow-slate-200/50 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/90 dark:shadow-slate-950/40"
      x-cloak
      x-show="open"
    >
      <#list locales as locale>
        <#if currentLocale != locale.label>
          <div class="px-4 py-2">
            <@link.kw color="secondary" href=locale.url size="small">
              ${locale.label}
            </@link.kw>
          </div>
        </#if>
      </#list>
    </div>
  </div>
</#macro>
