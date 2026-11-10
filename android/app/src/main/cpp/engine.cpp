#include <jni.h>
#include <string>
#include <vector>
#include "node.h"
extern "C" JNIEXPORT jint JNICALL Java_com_whatsgramy_app_EngineService_startNode(JNIEnv* env,jobject,jstring script,jstring directory){
 const char* s=env->GetStringUTFChars(script,nullptr);const char* d=env->GetStringUTFChars(directory,nullptr);
 std::vector<std::string> args={"node",s,d};env->ReleaseStringUTFChars(script,s);env->ReleaseStringUTFChars(directory,d);
 std::vector<char> storage;for(auto &a:args){storage.insert(storage.end(),a.begin(),a.end());storage.push_back(0);}std::vector<char*> argv;char* p=storage.data();for(auto &a:args){argv.push_back(p);p+=a.size()+1;}
 return node::Start(static_cast<int>(argv.size()),argv.data());
}
