<#macro kw content="" footer="" header="">
  <div class="space-y-6 rounded-2xl border border-slate-200/80 bg-white/85 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-sm dark:border-slate-700/80 dark:bg-slate-900/85 dark:shadow-slate-950/40 sm:p-8">
    <#if header?has_content>
      <div class="space-y-4">
        ${header}
      </div>
    </#if>
    <#if content?has_content>
      <div class="space-y-4">
        ${content}
      </div>
    </#if>
    <#if footer?has_content>
      <div class="space-y-4">
        ${footer}
      </div>
    </#if>
  </div>
</#macro>
