define(['jquery'], function ($) {
  return function () {
    var self = this;

    // TODO: point this at your deployed backend's APP_BASE_URL before
    // packaging the widget (see repo README "Деплой" section).
    var BACKEND_URL = 'https://your-domain.example';

    function t(code, fallback) {
      var value = self.i18n && self.i18n(code);
      return value || fallback;
    }

    // amoCRM widgets can't reliably claim a full dashboard-sized area from
    // any single manifest "location" (those are card/list side panels), so
    // instead of fighting that we anchor a small button into the leads list
    // toolbar (llist-0) and have it take over the whole viewport with an
    // overlay — the same "control the DOM directly, don't depend on an
    // uncertain amoCRM content-slot API" approach already used by the
    // teg_paint widget in this repo.
    function getAccountInfo() {
      var account = typeof AMOCRM !== 'undefined' && AMOCRM.constant ? AMOCRM.constant('account') : null;
      var system = self.system ? self.system() : {};
      return {
        id: (account && account.id) || system.amouser_id,
        subdomain: (account && account.subdomain) || system.subdomain,
        lang: system.current_lang || 'ru'
      };
    }

    function buildIframeSrc() {
      var info = getAccountInfo();
      var query = $.param({
        account_id: info.id,
        subdomain: info.subdomain,
        lang: info.lang
      });
      return BACKEND_URL + '/widget?' + query;
    }

    function openDashboard() {
      if ($('.leads-analysis-overlay').length) {
        return;
      }
      var $overlay = $(
        '<div class="leads-analysis-overlay">' +
          '<div class="leads-analysis-overlay__bar">' +
          '<button type="button" class="leads-analysis-overlay__close">&times;</button>' +
          '</div>' +
          '<iframe class="leads-analysis-overlay__frame" frameborder="0"></iframe>' +
          '</div>'
      );
      $overlay.find('iframe').attr('src', buildIframeSrc());
      $overlay.find('.leads-analysis-overlay__close').on('click', function () {
        $overlay.remove();
      });
      $('body').append($overlay);
    }

    function injectButton() {
      if ($('.js-leads-analysis-button').length) {
        return;
      }
      var $button = $('<button type="button" class="leads-analysis-button js-leads-analysis-button"></button>')
        .text(t('button.open', 'Анализ лидов'))
        .on('click', openDashboard);

      var $toolbar = $('.control-bar__group, .js-control-bar, .control-bar').first();
      if ($toolbar.length) {
        $toolbar.append($button);
      } else {
        $button.css({ position: 'fixed', top: '12px', right: '12px', zIndex: 9999 });
        $('body').append($button);
      }
    }

    this.callbacks = {
      init: function () {
        return true;
      },
      render: function () {
        injectButton();
        return true;
      },
      bind_actions: function () {
        return true;
      },
      settings: function ($modal_body) {
        $modal_body.html(
          '<div style="padding:16px">' +
            t('widget.description', '') +
            '<br /><br />Настройки дашборда (ключевой этап, этап продажи, оформление) открываются внутри самого дашборда — кнопка «' +
            t('button.open', 'Анализ лидов') +
            '» → вкладка «Настройки».</div>'
        );
        return true;
      },
      onSave: function () {
        return true;
      },
      destroy: function () {
        $('.js-leads-analysis-button').remove();
        $('.leads-analysis-overlay').remove();
        return true;
      }
    };

    return this;
  };
});
