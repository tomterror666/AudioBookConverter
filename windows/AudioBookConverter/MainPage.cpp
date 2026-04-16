#include "pch.h"
#include "MainPage.h"
#if __has_include("MainPage.g.cpp")
#include "MainPage.g.cpp"
#endif

#include "App.h"

#include <winrt/Windows.UI.Xaml.Media.h>

using namespace winrt;
using namespace xaml;

namespace winrt::AudioBookConverter::implementation
{
    MainPage::MainPage()
    {
        InitializeComponent();

        m_reactRootView.ComponentName(L"AudioBookConverter");
        m_reactRootView.MinHeight(400);
        if (auto const brush = Resources().TryLookup(box_value(L"ApplicationPageBackgroundThemeBrush")))
        {
            m_reactRootView.Background(brush.as<Media::Brush>());
        }

        LayoutRoot().Children().Append(m_reactRootView);

        auto const app = Application::Current().as<App>();
        m_reactRootView.ReactNativeHost(app->Host());
    }
}
