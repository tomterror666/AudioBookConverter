#pragma once
#include "MainPage.g.h"
#include <winrt/Microsoft.ReactNative.h>

namespace winrt::AudioBookConverter::implementation
{
    struct MainPage : MainPageT<MainPage>
    {
        MainPage();

      private:
        winrt::Microsoft::ReactNative::ReactRootView m_reactRootView{};
    };
}

namespace winrt::AudioBookConverter::factory_implementation
{
    struct MainPage : MainPageT<MainPage, implementation::MainPage>
    {
    };
}

